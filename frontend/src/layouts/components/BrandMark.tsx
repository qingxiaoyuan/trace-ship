/** 维保界面与通用布局共用系统品牌图标。 */
export function BrandMark({ small = false }: { small?: boolean }) {
  return <img src="/favicon.ico" alt="溯舟" className={`shrink-0 rounded-lg object-contain ${small ? 'h-6 w-6' : 'h-8 w-8'}`} />;
}
