import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";
import 'dotenv/config'
import { crossChainSwapTasks, stockTasks } from "./tasks/index.js";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  tasks: [...stockTasks, ...crossChainSwapTasks],
  solidity: {
    // CCIPLocalSimulator / BurnMintERC677Helper (CCIP-BnM) / IRouterClient は node_modules
    // 内の依存で、通常はコンパイルグラフに含まれても artifact が生成されない。ignition や
    // tasks から viem.getContractAt / deployContract で名前解決できるよう明示的に root file
    // として指定する。IRouterClient は実テストネットで CCIP 手数料(getFee)を見積もるのに使う。
    npmFilesToBuild: [
      "@chainlink/local/src/ccip/CCIPLocalSimulator.sol",
      "@chainlink/local/src/ccip/BurnMintERC677Helper.sol",
      "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol",
    ],
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
    // クロスチェーンswapサンプルの送信元役（実テストネット）。CCIPディレクトリで
    // Robinhood Chain Testnet との有効なレーンが確認できるチェーン。
    // https://docs.chain.link/ccip/directory/testnet/chain/ethereum-sepolia
    sepolia: {
      type: "http",
      url: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
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
