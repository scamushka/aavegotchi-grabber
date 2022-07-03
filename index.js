// Author: https://t.me/scamushka
import 'dotenv/config';
import ethers from 'ethers';
import { setTimeout } from 'timers/promises';
import fetch from 'node-fetch';
import logger from './logger.js';

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC);
const privateKey = process.env.PRIVATE_KEY;
const maxCost = +process.env.MAX_COST * 1e18;
const minPeriod = +process.env.MIN_PERIOD * 3600;
const minSplitBorrower = +process.env.MIN_SPLIT_BORROWER;
const minLevel = +process.env.MIN_LEVEL;
const gasLimit = +process.env.GAS_LIMIT;
let maxPriorityFeePerGas = ethers.BigNumber.from(4e10); // * fallback to 40 gwei
let maxFeePerGas = ethers.BigNumber.from(4e10); // * fallback to 40 gwei
let numberOfAttempts = 0;

const query = `
  {
    noWhitelist: gotchiLendings(
      skip: 0
      where: {tokensToShare_contains: ["0x403E967b044d4Be25170310157cB1A4Bf10bdD0f", "0x44A6e0BE76e1D9620A7F76588e4509fE4fa8E8C8", "0x6a3E7C3c6EF65Ee26975b12293cA1AAD7e1dAeD2", "0x42E5E06EF5b90Fe15F853F59299Fc96259209c5C"], period_gte: ${minPeriod}, whitelist: null, timeAgreed: 0, cancelled: false}
      orderBy: timeCreated
      orderDirection: desc
    ) {
      id
      upfrontCost
      period
      gotchi {
        id
        level
      }
      splitOther
      splitBorrower
      splitOwner
      gotchiTokenId
    }
  }
`;

async function borrow(signer, listingId, erc721TokenId, initialCost, period, revenueSplit) {
  try {
    const abi = [
      'function agreeGotchiLending(uint32 _listingId, uint32 _erc721TokenId, uint96 _initialCost, uint32 _period, uint8[3] _revenueSplit)',
    ];
    const contract = new ethers.Contract('0x86935F11C86623deC8a25696E1C19a8659CbF95d', abi, signer);
    // ! надо учить ts ❤️
    const borrowTx = await contract.agreeGotchiLending(+listingId, +erc721TokenId, ethers.utils.parseEther(ethers.utils.formatEther(initialCost)), +period, revenueSplit.map(item => +item), {
      gasLimit,
      maxPriorityFeePerGas,
      maxFeePerGas,
    });
    logger.info('borrow transaction sent');
    await borrowTx.wait();
    logger.info(`borrow success ${borrowTx.hash}`);

    if (process.env.WAIT_AFTER_BUY === 'true') {
      logger.info(`waiting ${(+period - 3600) / 3600} hour(s)`);
      await setTimeout((+period - 3600) * 1000);
      await main();
    }
  } catch (e) {
    logger.error(`failure: ${e.message}`);

    if (process.env.REPEAT === 'true') {
      await main();
    }
  }
}

async function main() {
  try {
    const response = await fetch('https://api.thegraph.com/subgraphs/name/aavegotchi/aavegotchi-core-matic', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
    const data = await response.json();
    const listing = data.data.noWhitelist.find(item => +item.upfrontCost <= maxCost && +item.gotchi.level >= minLevel && +item.splitBorrower >= minSplitBorrower);

    if (listing) {
      logger.info(listing);
      const wallet = new ethers.Wallet(privateKey);
      const signer = wallet.connect(provider);

      if (process.env.MAX_PRIORITY_FEE && process.env.MAX_FEE) {
        maxPriorityFeePerGas = ethers.utils.parseUnits(
          process.env.MAX_PRIORITY_FEE,
          'gwei',
        );
        maxFeePerGas = ethers.utils.parseUnits(
          process.env.MAX_FEE,
          'gwei',
        );
      } else {
        try {
          const feeResponse = await fetch('https://gasstation-mainnet.matic.network/v2');
          const feeData = await feeResponse.json();
          maxPriorityFeePerGas = ethers.utils.parseUnits(
            `${Math.ceil(feeData.fast.maxPriorityFee)}`,
            'gwei',
          );
          maxFeePerGas = ethers.utils.parseUnits(
            `${Math.ceil(feeData.fast.maxFee)}`,
            'gwei',
          );
        } catch (e) {
          logger.info('maxFeePerGas and maxPriorityFeePerGas by default');
        }
      }

      await borrow(signer, listing.id, listing.gotchiTokenId, listing.upfrontCost, listing.period, [listing.splitOwner, listing.splitBorrower, listing.splitOther]);
    } else {
      numberOfAttempts += 1;
      logger.info(`not found, try again ${numberOfAttempts}`);
      await main();
    }
  } catch (e) {
    logger.fatal(`stopping the bot: ${e.message}`);
  }
}

main();
