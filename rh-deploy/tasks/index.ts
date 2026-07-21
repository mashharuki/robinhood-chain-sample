import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";

/**
 * Stock Token 学習用タスク群。
 * hardhat.config.ts の `tasks: [...stockTasks]` で登録される。
 * アクション本体は setAction の lazy import で読み込まれるため、
 * タスクを実行しない限り config の起動コストは増えない。
 */

const tokenOption = {
  name: "token",
  description: "StockToken のアドレス（省略時は ignition のデプロイ記録から解決）",
  type: ArgumentType.STRING,
  defaultValue: "",
} as const;

const feedOption = {
  name: "feed",
  description: "MockPriceFeed のアドレス（省略時は ignition のデプロイ記録から解決）",
  type: ArgumentType.STRING,
  defaultValue: "",
} as const;

export const stockTasks = [
  task("stock:info", "Stock Token の基本情報と uiMultiplier の状態を表示")
    .addOption(tokenOption)
    .setAction(() => import("./stock-info.js"))
    .build(),

  task("stock:balance", "raw balance と株数換算 (balanceOfUI) を並べて表示")
    .addOption(tokenOption)
    .addOption({
      name: "holder",
      description: "照会するアドレス（省略時は自分のウォレット）",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .setAction(() => import("./stock-balance.js"))
    .build(),

  task("stock:mint", "発行体（owner）としてミント — Authorized Participant の模擬")
    .addOption(tokenOption)
    .addOption({
      name: "to",
      description: "ミント先アドレス（省略時は自分のウォレット)",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .addOption({
      name: "amount",
      description: "ミント量（トークン単位。例: 100）",
      type: ArgumentType.STRING,
      defaultValue: "100",
    })
    .setAction(() => import("./stock-mint.js"))
    .build(),

  task("stock:split", "株式分割をシミュレート（uiMultiplier × ratio を予約更新）")
    .addOption(tokenOption)
    .addOption({
      name: "ratio",
      description: "分割比率（2 = 2:1 分割。1.5 など小数も可）",
      type: ArgumentType.FLOAT,
      defaultValue: 2,
    })
    .addOption({
      name: "delay",
      description: "有効化までの秒数（pending → active の遷移を観察できる）",
      type: ArgumentType.INT,
      defaultValue: 60,
    })
    .setAction(() => import("./stock-split.js"))
    .build(),

  task("stock:price", "モックフィードの価格・更新時刻・oraclePaused を表示")
    .addOption(feedOption)
    .setAction(() => import("./stock-price.js"))
    .build(),

  task("stock:set-price", "モックフィードの価格更新・オラクル停止（Chainlink ノードの役）")
    .addOption(feedOption)
    .addOption({
      name: "price",
      description: "新しい価格（USD。例: 205.50）",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .addOption({
      name: "paused",
      description: "オラクル停止フラグ（true / false）— コーポレートアクションの模擬",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .setAction(() => import("./stock-set-price.js"))
    .build(),

  task("stock:value", "StockViewer 経由で USD 評価額と株数換算を表示")
    .addOption(tokenOption)
    .addOption(feedOption)
    .addOption({
      name: "viewer",
      description: "StockViewer のアドレス（省略時は ignition のデプロイ記録から解決）",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .addOption({
      name: "holder",
      description: "照会するアドレス（省略時は自分のウォレット）",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .addOption({
      name: "staleness",
      description: "許容する価格経過秒数（実フィードは 24/5 更新なので週末を考慮すること）",
      type: ArgumentType.INT,
      defaultValue: 259_200, // 3 days
    })
    .setAction(() => import("./stock-value.js"))
    .build(),

  task("stock:live", "メインネットの実 Stock Token を read-only 照会（ガス・秘密鍵不要）")
    .addPositionalArgument({
      name: "ticker",
      description: `ティッカー（AAPL, TSLA, NVDA, SPY など）`,
      type: ArgumentType.STRING,
    })
    .addOption({
      name: "holder",
      description: "残高を照会するアドレス（任意）",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .addOption({
      name: "feed",
      description: "その銘柄の Chainlink フィードアドレス（任意。Chainlink docs で確認して渡す）",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .setAction(() => import("./stock-live.js"))
    .build(),
];

/** CrossChainSwapModule のデプロイ済みコントラクトを指すオプション（省略時は ignition の記録から解決） */
function deployedAddressOption<Name extends string>(name: Name, contract: string) {
  return {
    name,
    description: `${contract} のアドレス（省略時は ignition のデプロイ記録から解決）`,
    type: ArgumentType.STRING,
    defaultValue: "",
  } as const;
}

export const crossChainSwapTasks = [
  task("swap:buy", "クロスチェーンswapサンプル: 決済トークンでmAAPLを購入（StockSwapSender.buyStock）")
    .addOption({
      name: "amount",
      description: "決済トークンの送金量（トークン単位。例: 100）",
      type: ArgumentType.STRING,
      defaultValue: "100",
    })
    .addOption({
      name: "minAmountOut",
      description: "最小受取mAAPL量（スリッページ保護。未達なら宛先側でescrow退避される）",
      type: ArgumentType.STRING,
      defaultValue: "0",
    })
    .addOption({
      name: "recipient",
      description: "mAAPLの受取アドレス（省略時は自分のウォレット）",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .addOption({
      name: "value",
      description: "CCIP手数料に充てるnative送金量（余剰は自動返金される。ローカルシミュレータ想定のデフォルト）",
      type: ArgumentType.STRING,
      defaultValue: "1",
    })
    .addOption(deployedAddressOption("sender", "StockSwapSender"))
    .addOption(deployedAddressOption("receiver", "StockSwapReceiver"))
    .addOption(deployedAddressOption("simulator", "CCIPLocalSimulator"))
    .setAction(() => import("./swap-buy.js"))
    .build(),

  task("swap:info", "クロスチェーンswapサンプルの状態表示（プール残高・allowlist・escrow・フィード）")
    .addOption(deployedAddressOption("sender", "StockSwapSender"))
    .addOption(deployedAddressOption("receiver", "StockSwapReceiver"))
    .addOption(deployedAddressOption("simulator", "CCIPLocalSimulator"))
    .addOption({
      name: "holder",
      description: "escrow残高を照会するアドレス（省略時は自分のウォレット）",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .setAction(() => import("./swap-info.js"))
    .build(),

  // 実テストネット（Ethereum Sepolia → Robinhood Chain Testnet）向け。
  // ignition/modules/CrossChainSwap{Sender,Receiver}Testnet.ts のデプロイ後に使う。
  task("swap:allowlist-source", "実テストネット専用セットアップ: ReceiverにSender(sepolia)からの受信を許可する")
    .addOption(deployedAddressOption("receiver", "StockSwapReceiver"))
    .addOption(deployedAddressOption("sender", "StockSwapSender"))
    .setAction(() => import("./swap-allowlist-source.js"))
    .build(),

  task("swap:buy-testnet", "実テストネット（Ethereum Sepolia → Robinhood Chain Testnet）で本物のCCIPメッセージを送る")
    .addOption({
      name: "amount",
      description: "決済トークンの送金量（トークン単位。drip()回数がかかるため少なめ推奨。例: 5）",
      type: ArgumentType.STRING,
      defaultValue: "5",
    })
    .addOption({
      name: "minAmountOut",
      description: "最小受取mAAPL量（スリッページ保護。未達なら宛先側でescrow退避される）",
      type: ArgumentType.STRING,
      defaultValue: "0",
    })
    .addOption({
      name: "recipient",
      description: "mAAPLの受取アドレス（省略時は自分のウォレット）",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .addOption({
      name: "feeBufferBps",
      description: "Router.getFee見積りに上乗せするバッファ（bps単位。余剰は自動返金される）",
      type: ArgumentType.INT,
      defaultValue: 1_000, // 10%
    })
    .addOption(deployedAddressOption("sender", "StockSwapSender"))
    .addOption(deployedAddressOption("receiver", "StockSwapReceiver"))
    .setAction(() => import("./swap-buy-testnet.js"))
    .build(),

  task("swap:info-testnet", "実テストネットの状態表示（Sepolia側・Robinhood Chain Testnet側を横断して表示）")
    .addOption(deployedAddressOption("sender", "StockSwapSender"))
    .addOption(deployedAddressOption("receiver", "StockSwapReceiver"))
    .addOption({
      name: "holder",
      description: "escrow残高を照会するアドレス（省略時は自分のウォレット）",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .setAction(() => import("./swap-info-testnet.js"))
    .build(),
];
