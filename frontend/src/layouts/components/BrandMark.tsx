/** 维保界面沿用 Penpot 的「舟」字品牌标记。 */
export function BrandMark({ small = false }: { small?: boolean }) {
  return <span role="img" aria-label="溯舟" className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-[#5441ed] font-semibold text-white ${small ? 'h-6 w-6 text-xs' : 'h-8 w-8 text-[15px]'}`}>舟</span>;
}
