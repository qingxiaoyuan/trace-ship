/** jsdom 未提供元素 scrollTo；只模拟位置，真实布局和滚动仍由浏览器验收。 */
if (!HTMLElement.prototype.scrollTo) {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value(this: HTMLElement, optionsOrX?: ScrollToOptions | number, y?: number) {
      if (typeof optionsOrX === 'number') {
        this.scrollLeft = optionsOrX;
        if (y !== undefined) this.scrollTop = y;
      } else {
        if (optionsOrX?.left !== undefined) this.scrollLeft = optionsOrX.left;
        if (optionsOrX?.top !== undefined) this.scrollTop = optionsOrX.top;
      }
    },
  });
}
