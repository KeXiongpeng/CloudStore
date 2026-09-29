/**
 * Markdown 切块器（纯函数，不依赖 NestJS 和数据库，方便单独测试）。
 *
 * 设计目标（对应 D2 交接文档 Step 2/3）：
 * 1. 优先按标题切：每个标题连同它的正文构成一个 section，headingPath 记录层级路径；
 * 2. section 过长时再按段落（空行分隔）二次切分，段落是原子的，不会从中间截断；
 * 3. 围栏代码块（``` 包裹）是原子块：内部的 # 和空行不参与切块；
 * 4. 单个块超过上限时（超长段落/超长代码块）按字符窗口硬切，相邻窗口保留 overlap，
 *    让跨界语义在相邻两个向量里都存在；
 * 5. 每个 chunk 记录源文件的起止行号，检索结果可以溯源到原始 Markdown 位置。
 */

/** 切块结果：content 是最终送去 embedding 的文本，其余字段用于溯源。 */
export interface MarkdownChunk {
  content: string;
  /** 标题层级路径，如 ["D2交接", "数据模型"]；标题之前的导语为 []。 */
  headingPath: string[];
  /** 源文件起始行号（从 1 开始，闭区间）。 */
  startLine: number;
  /** 源文件结束行号（闭区间）。 */
  endLine: number;
}

export interface ChunkerOptions {
  /** 单个 chunk 的目标长度上限（字符数，中英文都按字符算）。默认 800。 */
  maxChunkChars?: number;
  /** 硬切分时相邻窗口的重叠字符数。默认 80。 */
  overlapChars?: number;
}

/** 正文内部的一个不可再分（或按窗口硬切）的内容块。 */
interface Block {
  lines: string[];
  startLine: number;
  endLine: number;
}

/** 一次标题扫描后的状态：headingPath + 标题行 + 这个标题下的正文块。 */
interface Section {
  headingPath: string[];
  /** 标题行的原始文本（含 # 前缀），chunk 内容会以它开头，保证片段可独立理解。 */
  headingLine: string | null;
  /** section 起始行号（标题行所在行；导语 section 恒为 1）。 */
  startLine: number;
  blocks: Block[];
}

// 标题形如 "# 标题"、"## 标题"；要求 # 后必须有空格，避免把 "#hashtag" 当标题。
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;
// 围栏代码块只识别 ``` 标记（~~~ 暂不支持，D2 最小闭环够用）。
const FENCE_PATTERN = /^```/;

/**
 * 把整篇 Markdown 切成 chunk 列表。
 * 两阶段：先按标题扫描出 section 列表，再把每个 section 打包成一个或多个 chunk。
 */
export function chunkMarkdown(content: string, options: ChunkerOptions = {}): MarkdownChunk[] {
  const maxChunkChars = options.maxChunkChars ?? 800;
  const overlapChars = options.overlapChars ?? 80;
  const sections = splitIntoSections(content);

  const chunks: MarkdownChunk[] = [];
  for (const section of sections) {
    chunks.push(...packSection(section, maxChunkChars, overlapChars));
  }
  return chunks;
}

/**
 * 阶段一：按行扫描，遇到（代码块外的）标题就开启新 section；
 * 标题之间的内容按空行切成段落块，围栏代码块保持为一个完整块。
 */
function splitIntoSections(content: string): Section[] {
  const lines = content.split(/\r?\n/);
  const sections: Section[] = [];

  // headingStack 维护当前标题层级：遇到新标题时，把层级 >= 自己的祖先弹出，再把自己压入。
  // 例如扫描到 "### B" 时栈是 [# A]，A.level=1 不满足 >= 3，所以直接压入得到路径 [A, B]。
  const headingStack: Array<{ level: number; text: string }> = [];
  let current: Section = { headingPath: [], headingLine: null, startLine: 1, blocks: [] };
  sections.push(current);

  let inFence = false;
  let fenceBlock: Block | null = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1; // 行号从 1 开始，方便人对照编辑器。

    if (inFence) {
      // 代码块内部：所有行（包括空行和 # 开头的行）都原样累积，直到遇到结束围栏。
      fenceBlock!.lines.push(line);
      fenceBlock!.endLine = lineNumber;
      if (FENCE_PATTERN.test(line)) {
        inFence = false;
        current.blocks.push(fenceBlock!);
        fenceBlock = null;
      }
      return;
    }

    if (FENCE_PATTERN.test(line)) {
      // 代码块开始：新建一个块，在结束围栏出现前所有行都属于它。
      inFence = true;
      fenceBlock = { lines: [line], startLine: lineNumber, endLine: lineNumber };
      return;
    }

    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      const level = heading[1]?.length ?? 0;
      const text = heading[2] ?? '';
      while (headingStack.length > 0) {
        const top = headingStack[headingStack.length - 1];
        if (!top || top.level < level) {
          break;
        }
        headingStack.pop();
      }
      headingStack.push({ level, text });

      // 标题开启一个新 section，标题行本身作为 section 的开头。
      current = {
        headingPath: headingStack.map((entry) => entry.text),
        headingLine: line,
        startLine: lineNumber,
        blocks: [],
      };
      sections.push(current);
      return;
    }

    if (line.trim() === '') {
      return; // 空行只是段落分隔符，不进入任何块。
    }

    const lastBlock = current.blocks[current.blocks.length - 1];
    if (lastBlock && lastBlock.endLine === lineNumber - 1) {
      // 与上一个块物理紧挨（中间没有空行），是同一段落的延续行。
      lastBlock.lines.push(line);
      lastBlock.endLine = lineNumber;
    } else {
      current.blocks.push({ lines: [line], startLine: lineNumber, endLine: lineNumber });
    }
  });

  // 文档以未闭合的代码块结尾：把残留的 fenceBlock 也收进当前 section。
  if (fenceBlock) {
    current.blocks.push(fenceBlock);
  }
  return sections;
}

/**
 * 阶段二：把一个 section 打包成 chunk。
 * - 标题行作为该 section 所有 chunk 的公共前缀（超长 section 的后续片段也带标题，独立可读）；
 * - 先做"贪心装箱"：在预算内尽量多装段落，减少 chunk 数量；
 * - 装不下的超大块单独按字符窗口硬切并保留 overlap。
 */
function packSection(
  section: Section,
  maxChunkChars: number,
  overlapChars: number,
): MarkdownChunk[] {
  // 空文档（没有标题也没有内容）不产出空 chunk。
  if (!section.headingLine && section.blocks.length === 0) {
    return [];
  }

  const prefix = section.headingLine ? `${section.headingLine}\n\n` : '';
  const budget = Math.max(1, maxChunkChars - prefix.length);

  const chunks: MarkdownChunk[] = [];
  let currentGroup: Block[] = [];
  let currentLength = 0;

  const flushGroup = () => {
    const firstBlock = currentGroup[0];
    const lastBlock = currentGroup[currentGroup.length - 1];
    if (!firstBlock || !lastBlock) {
      return;
    }
    chunks.push({
      content: (
        prefix + currentGroup.map((block) => block.lines.join('\n')).join('\n\n')
      ).trimEnd(),
      headingPath: section.headingPath,
      // chunk 内容以标题行开头，溯源起点必须是标题行；导语（无标题）才用正文首行。
      startLine: section.headingLine ? section.startLine : firstBlock.startLine,
      endLine: lastBlock.endLine,
    });
    currentGroup = [];
    currentLength = 0;
  };

  for (const block of section.blocks) {
    const blockText = block.lines.join('\n');

    if (blockText.length > budget) {
      // 单块超预算（超长段落或超长代码块）：先收尾当前组，再对块做带 overlap 的硬切分。
      flushGroup();
      chunks.push(...hardSplitBlock(prefix, section, block, budget, overlapChars));
      continue;
    }

    if (currentLength > 0 && currentLength + blockText.length + 2 > budget) {
      // 加上这个块会超预算：先收尾当前组，再开新组。+2 是块之间 '\n\n' 分隔符的长度。
      flushGroup();
    }
    currentGroup.push(block);
    currentLength += (currentLength > 0 ? 2 : 0) + blockText.length;
  }
  flushGroup();

  // 标题存在但没有正文：产出只有标题的 chunk，保证文档结构完整（空章节也是文档的一部分）。
  if (chunks.length === 0 && section.headingLine) {
    chunks.push({
      content: section.headingLine,
      headingPath: section.headingPath,
      startLine: section.startLine,
      endLine: section.startLine,
    });
  }
  return chunks;
}

/** 把单个超长块按字符窗口切成多个 chunk，相邻窗口重叠 overlapChars 个字符。 */
function hardSplitBlock(
  prefix: string,
  section: Section,
  block: Block,
  budget: number,
  overlapChars: number,
): MarkdownChunk[] {
  const text = block.lines.join('\n');
  // overlap 必须小于窗口，否则窗口会原地打转；至少保证 1 个字符的步进。
  const overlap = Math.min(overlapChars, budget - 1);

  const chunks: MarkdownChunk[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + budget, text.length);
    chunks.push({
      content: (prefix + text.slice(start, end)).trimEnd(),
      headingPath: section.headingPath,
      // 行号起点优先取标题行（chunk 内容以它开头）；终点取块范围，足够溯源。
      startLine: section.headingLine ? section.startLine : block.startLine,
      endLine: block.endLine,
    });
    if (end === text.length) {
      break;
    }
    start += budget - overlap;
  }
  return chunks;
}
