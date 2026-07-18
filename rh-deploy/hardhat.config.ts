import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";
import 'dotenv/config'
import { stockTasks } from "./tasks/index.js";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  tasks: [...stockTasks],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    // ローカル学習用: 別ターミナルで `bunx hardhat node` を起動して使う
    localhost: {
      type: "http",
      url: "http://127.0.0.1:8545",
    },
    robinhood: {
      type: "http",
      url: process.env.RH_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      // PRIVATE_KEY 未設定でも read-only タスク（stock:live 等）は使えるようにする
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY as `0x${string}`] : [],
    },
    robinhoodTestnet: {
      type: "http",
      url: process.env.RH_TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY as `0x${string}`] : [],
    },
  },
  // Blockscout 検証（API キー不要）: bunx hardhat verify --network robinhoodTestnet <address> ...
  verify: {
    blockscout: { enabled: true },
  },
  chainDescriptors: {
    4663: {
      name: "robinhood",
      blockExplorers: {
        blockscout: {
          name: "Robinhood Chain Explorer",
          url: "https://robinhoodchain.blockscout.com",
          apiUrl: "https://robinhoodchain.blockscout.com/api",
        },
      },
    },
    46630: {
      name: "robinhoodTestnet",
      blockExplorers: {
        blockscout: {
          name: "Robinhood Chain Testnet Explorer",
          url: "https://explorer.testnet.chain.robinhood.com",
          apiUrl: "https://explorer.testnet.chain.robinhood.com/api",
        },
      },
    },
  },
});
