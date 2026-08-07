/**
 * AI 生成 commit 信息的规范校验与自动校正。
 *
 * 该模块只做纯字符串处理，不涉及 Webview、Git API 或网络请求。
 */

/** 思维块标签列表 */
const THINK_TAGS = ["think", "thinking", "reasoning", "analysis", "reflection"];

/** 禁用前缀行（引导 AI 或用户填写的标题行） */
const FORBIDDEN_PREFIXES = [
  "更新内容：",
  "[A为功能增加 F为BUG修复]：",
  "[A 为功能增加 F 为 BUG 修复]：",
  "思考：",
  "分析：",
  "推理：",
  "备注：",
  "说明：",
  "总结：",
];

/** 模糊词黑名单：描述应面向用户价值，避免空泛词汇 */
const FUZZY_WORDS = [
  "优化",
  "调整",
  "修改",
  "重构",
  "完善",
  "改进",
  "更新",
  "微调",
  "改动",
  "修复了",
];

/** 标题行正则：`<feat> 描述` 或 `<fix> 描述` */
const TITLE_RE = /^\s*<(feat|fix)>\s*(.+)$/;
/** 单行提交正则：`<feat> A 描述` 或 `<fix> F 描述` */
const SINGLE_RE = /^\s*<(feat|fix)>\s+(A|F)\s+\S.*$/;
/** 复杂提交条目正则：`1. A 描述` */
const ITEM_RE = /^\s*(\d+)\.\s+([AF])\s+(\S.*)$/;

export interface CommitValidationResult {
  /** 结构是否完全合规 */
  ok: boolean;
  /** 自动校正后的文本 */
  corrected: string;
  /** 结构性错误列表 */
  errors: string[];
  /** 语义/风格警告列表（如模糊词） */
  warnings: string[];
}

/**
 * 对 AI 输出做机械层面的清洗：
 * 1. 统一换行、去首尾空白；
 * 2. 删除代码围栏标记行；
 * 3. 删除 `<think>` / `<thinking>` / `<reasoning>` / `<analysis>` / `<reflection>` 块；
 * 4. 过滤禁用前缀行；
 * 5. 复杂提交归一化为“一个标题 + 连续编号列表”。
 */
export function autoCorrectCommit(text: string): string {
  if (!text) {
    return "";
  }

  // 1. 统一换行、去首尾空白
  let result = text.replace(/\r\n/g, "\n").trim();
  if (!result) {
    return "";
  }

  // 2. 删除代码围栏标记行（``` 或 ```language），保留内部文本
  result = result
    .split("\n")
    .filter((line) => !/^\s*```/.test(line))
    .join("\n");

  // 3. 字符串扫描删除思维块，避免正则回溯导致长文本卡顿
  for (const tag of THINK_TAGS) {
    const open = `<${tag}`;
    const close = `</${tag}>`;
    let safety = 0;
    while (safety++ < 100) {
      const start = result.indexOf(open);
      if (start === -1) {
        break;
      }
      const tagEnd = result.indexOf(">", start);
      if (tagEnd === -1) {
        break;
      }
      const end = result.indexOf(close, tagEnd + 1);
      if (end === -1) {
        break;
      }
      result = result.slice(0, start) + result.slice(end + close.length);
    }
  }

  // 4. 过滤禁用前缀行
  result = result
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !FORBIDDEN_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
    })
    .join("\n");

  // 5. 复杂提交归一化
  return normalizeComplexCommit(result);
}

/**
 * 将复杂提交归一化为：
 *
 *   <feat> 标题描述
 *
 *   1. A xxx
 *   2. F yyy
 *
 * 规则：保留第一个标题行；丢弃重复标题行、空行、无法识别的行；
 * 条目按出现顺序重新连续编号。
 */
function normalizeComplexCommit(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return "";
  }

  const titleIdx = lines.findIndex((line) => TITLE_RE.test(line));
  const firstItemIdx = lines.findIndex((line) => ITEM_RE.test(line));

  // 没有同时出现标题行和条目行，不视为复杂提交，直接拼接返回
  if (titleIdx === -1 || firstItemIdx === -1) {
    return lines.join("\n");
  }

  const titleLine = lines[titleIdx];
  const items: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === titleIdx) {
      continue;
    }
    const line = lines[i];
    if (TITLE_RE.test(line) || /^\s*$/.test(line)) {
      continue;
    }
    items.push(line);
  }

  let n = 0;
  const normalizedItems = items.map((line) => {
    if (ITEM_RE.test(line)) {
      n += 1;
      return line.replace(/^\s*\d+\./, `${n}.`);
    }
    return line;
  });

  return [titleLine, "", ...normalizedItems].join("\n");
}

/**
 * 对 AI 输出先自动校正，再做结构校验。
 *
 * 结构性错误会放入 errors；模糊词等语义问题会放入 warnings。
 */
export function validateCommit(text: string): CommitValidationResult {
  const corrected = autoCorrectCommit(text);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!corrected) {
    errors.push("AI 输出清洗后为空");
    return { ok: false, corrected, errors, warnings };
  }

  const lines = corrected
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // 必须包含 A/F 标识
  const hasAnyAF = lines.some(
    (line) => SINGLE_RE.test(line) || ITEM_RE.test(line),
  );
  if (!hasAnyAF) {
    errors.push("未找到 A（功能）或 F（修复）标识");
  }

  const isSingleLine = lines.length === 1;

  if (isSingleLine) {
    const line = lines[0];
    if (!SINGLE_RE.test(line)) {
      errors.push("单行提交格式应为 `<feat> A 描述` 或 `<fix> F 描述`");
    }
    if (/\|/.test(line)) {
      errors.push("单行提交不能同时包含 A 和 F，应使用复杂提交格式");
    }
  } else {
    // 复杂提交校验
    const titleIdx = lines.findIndex((line) => TITLE_RE.test(line));
    if (titleIdx === -1) {
      errors.push("复杂提交缺少 `<feat>` 或 `<fix>` 标题行");
    } else {
      const titleCount = lines.filter((line) => TITLE_RE.test(line)).length;
      if (titleCount > 1) {
        errors.push(`复杂提交只能有一个标题行，发现 ${titleCount} 个`);
      }

      const itemLines = lines
        .slice(titleIdx + 1)
        .filter((line) => !TITLE_RE.test(line));
      if (itemLines.length === 0) {
        errors.push("复杂提交标题下缺少编号条目");
      } else {
        let expected = 1;
        for (const line of itemLines) {
          const match = line.match(ITEM_RE);
          if (!match) {
            errors.push(`条目格式不正确或包含非条目内容："${line}"`);
            continue;
          }
          const num = parseInt(match[1], 10);
          if (num !== expected) {
            errors.push(`编号不连续：期望 ${expected}，实际 ${num}`);
          }
          expected++;
        }
      }
    }
  }

  // 模糊词检测：仅作为警告，不阻断填充
  for (const line of lines) {
    for (const word of FUZZY_WORDS) {
      if (line.includes(word)) {
        warnings.push(`描述包含模糊词 "${word}"：${line}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    corrected,
    errors,
    warnings,
  };
}
