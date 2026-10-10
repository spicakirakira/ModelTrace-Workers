import { BUILTIN_BANKS_GZ_B64 } from "./builtin-banks-data.js";

let cachedBanks = null;

export async function getBuiltinBanks() {
  if (cachedBanks) return cachedBanks;

  // Decompress base64 gzip data
  const binaryString = atob(BUILTIN_BANKS_GZ_B64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  cachedBanks = JSON.parse(text);
  return cachedBanks;
}

export function resetBanksCache() {
  cachedBanks = null;
}
