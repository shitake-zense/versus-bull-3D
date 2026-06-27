// ルームID生成: adjective-noun-3digit（例: swift-bull-492）

const ADJECTIVES = [
  'swift', 'brave', 'fierce', 'silent', 'wild', 'royal', 'shadow', 'iron',
  'lunar', 'solar', 'crimson', 'azure', 'golden', 'frost', 'storm', 'ember',
  'rapid', 'noble', 'savage', 'mighty', 'arctic', 'dusty', 'rogue', 'cosmic',
];

const NOUNS = [
  'bull', 'bear', 'horn', 'hoof', 'mane', 'fang', 'claw', 'tusk',
  'ranch', 'arena', 'rodeo', 'matador', 'bison', 'ox', 'yak', 'buffalo',
  'comet', 'falcon', 'titan', 'raven', 'wolf', 'lynx', 'puma', 'cobra',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateRoomId(): string {
  const digits = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${digits}`;
}
