import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";
import 'dotenv/config'

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
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
    robinhood: {
      type: "http",
      url: process.env.RH_RPC_URL as string,
      chainId: 4663,
      accounts: [process.env.PRIVATE_KEY as `0x${string}`],
    },
    robinhoodTestnet: {
      type: "http",
      url: process.env.RH_TESTNET_RPC_URL as string,
      chainId: 46630,
      accounts: [process.env.PRIVATE_KEY as `0x${string}`],
    },
  },
  etherscan: {
    apiKey: { robinhood: "empty" },
    customChains: [
      {
        network: "robinhood",
        chainId: 4663,
        urls: {
          apiURL: "https://robinhoodchain.blockscout.com/api",
          browserURL: "https://robinhoodchain.blockscout.com/",
        },
      },
      {
        network: "robinhoodTestnet",
        chainId: 46630,
        urls: {
          apiURL: "https://robinhoodchain.blockscout.com/api",
          browserURL: "https://robinhoodchain.blockscout.com/",
        },
      },
    ],
  },
});
