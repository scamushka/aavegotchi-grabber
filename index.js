// author https://t.me/scamushka
import 'dotenv/config';
import ethers from 'ethers';
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
    noWhitelist: gotchiLendings(where:{tokensToShare_contains:["0x403E967b044d4Be25170310157cB1A4Bf10bdD0f","0x44A6e0BE76e1D9620A7F76588e4509fE4fa8E8C8","0x6a3E7C3c6EF65Ee26975b12293cA1AAD7e1dAeD2","0x42E5E06EF5b90Fe15F853F59299Fc96259209c5C"], whitelist:null, timeAgreed:0, cancelled:false}, orderBy:timeCreated, orderDirection:desc) {
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
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
    logger.info('borrow transaction sent');
    await borrowTx.wait();
    logger.info(`borrow success ${borrowTx.hash}`);
  } catch (e) {
    logger.error(`failure: ${e.message}`);
  }
}

async function main() {
  try {
    const response = await fetch('https://static.138.182.90.157.clients.your-server.de/subgraphs/name/aavegotchi/aavegotchi-core-matic-lending-two', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
    const data = await response.json();
    const gotchi = data.data.noWhitelist.find(listing => +listing.upfrontCost <= maxCost && +listing.period >= minPeriod && +listing.gotchi.level >= minLevel && +listing.splitBorrower >= minSplitBorrower);

    if (gotchi) {
      logger.info(gotchi);
      const wallet = new ethers.Wallet(privateKey);
      const signer = wallet.connect(provider);

      try {
        const feeResponse = await fetch('https://gasstation-mainnet.matic.network/v2');
        const feeData = await feeResponse.json();
        maxFeePerGas = ethers.utils.parseUnits(
          `${Math.ceil(feeData.fast.maxFee)}`,
          'gwei',
        );
        maxPriorityFeePerGas = ethers.utils.parseUnits(
          `${Math.ceil(feeData.fast.maxPriorityFee)}`,
          'gwei',
        );
      } catch (e) {
        logger.info('maxFeePerGas and maxPriorityFeePerGas by default');
      }

      await borrow(signer, gotchi.id, gotchi.gotchi.id, gotchi.upfrontCost, gotchi.period, [gotchi.splitOwner, gotchi.splitBorrower, gotchi.splitOther]);
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
