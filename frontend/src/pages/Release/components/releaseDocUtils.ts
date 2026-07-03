export interface MdTableRow {
  key: string;
  value: string;
}

type CheckboxConfig = {
  options: string[];
  exclusive: boolean;
};

/** 需要以复选框展示的字段配置 */
export const CHECKBOX_FIELDS: Record<string, CheckboxConfig> = {
  '变更类型': { options: ['无配置项改动', '有配置项改动'], exclusive: true },
  '是否影响其他功能': { options: ['否', '是'], exclusive: true },
  '测试验证': { options: ['自测试通过', '研发测试复验通过'], exclusive: false },
};

export function isCheckboxField(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CHECKBOX_FIELDS, key);
}

/** 根据当前值和字段配置，返回已选中的选项列表 */
export function getSelectedOptions(value: string, config: CheckboxConfig): string[] {
  if (config.exclusive) {
    const selected = config.options.find((opt) => value.includes(opt));
    return selected ? [selected] : [config.options[0]];
  }
  return config.options.filter((opt) => value.includes(opt));
}

/** 切换选项后生成新的单元格值 */
export function toggleOption(current: string, option: string, config: CheckboxConfig): string {
  if (config.exclusive) {
    return option;
  }
  const selected = getSelectedOptions(current, { ...config, exclusive: false });
  const index = selected.indexOf(option);
  if (index >= 0) {
    selected.splice(index, 1);
  } else {
    selected.push(option);
  }
  return selected.length > 0 ? selected.join('、') : '未完成';
}

/** 处理复选框变更，并维护"配置项改动"行的动态插入/移除 */
export function applyCheckboxChange(
  rows: MdTableRow[],
  idx: number,
  value: string
): MdTableRow[] {
  const row = rows[idx];
  const next = rows.map((r, i) => (i === idx ? { ...r, value } : r));

  if (row.key === '变更类型') {
    const hasConfigChange = value.includes('有配置项改动');
    const configIdx = next.findIndex((r) => r.key === '配置项改动');
    if (hasConfigChange) {
      if (configIdx < 0) {
        next.splice(idx + 1, 0, { key: '配置项改动', value: '' });
      }
    } else if (configIdx >= 0) {
      next.splice(configIdx, 1);
    }
  }

  return next;
}
