import { readFile } from "node:fs/promises";
import path from "node:path";
import { formatUnits } from "viem";

export const MULTIPLIER_SCALE = 10n ** 18n;

/** Ignition の deployed_addresses.json から StockTokenModule のアドレスを解決する */
export async function resolveDeployed(
  rootDir: string,
  chainId: number,
  contract: "StockToken" | "MockPriceFeed" | "StockViewer",
): Promise<`0x${string}`> {
  const file = path.join(rootDir, "ignition", "deployments", `chain-${chainId}`, "deployed_addresses.json");
  let json: Record<string, string>;
  try {
    json = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(
      `chain-${chainId} へのデプロイ記録が見つかりません (${file})。` +
        `先に \`bun run deploy:stock\`（または --network を合わせて ignition deploy）を実行するか、` +
        `--token / --feed / --viewer オプションでアドレスを直接指定してください。`,
    );
  }
  const address = json[`StockTokenModule#${contract}`];
  if (address === undefined) {
    throw new Error(`deployed_addresses.json に StockTokenModule#${contract} がありません`);
  }
  return address as `0x${string}`;
}

/** 18 decimals のトークン量を人間向けに整形 */
export function fmtToken(amount: bigint): string {
  return formatUnits(amount, 18);
}

/** 8 decimals の USD 価格を人間向けに整形 */
export function fmtUsd8(amount: bigint): string {
  return `$${formatUnits(amount, 8)}`;
}

/** 18 decimals の USD 値を人間向けに整形 */
export function fmtUsd18(amount: bigint): string {
  return `$${formatUnits(amount, 18)}`;
}

/** 1e18 固定小数点の multiplier を "2.0x" 形式で整形 */
export function fmtMultiplier(multiplier: bigint): string {
  return `${formatUnits(multiplier, 18)}x`;
}

export function fmtTimestamp(ts: bigint): string {
  if (ts === 0n) return "(なし)";
  return `${ts} (${new Date(Number(ts) * 1000).toISOString()})`;
}
