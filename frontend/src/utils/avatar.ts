const avatarColors = [
  '#2563EB', // blue
  '#D97706', // amber
  '#7C3AED', // violet
  '#DC2626', // red
  '#059669', // green
  '#0891B2', // cyan
  '#BE185D', // pink
  '#4338CA', // indigo
];

export function getAvatarColor(name?: string): string {
  if (!name) return avatarColors[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}
