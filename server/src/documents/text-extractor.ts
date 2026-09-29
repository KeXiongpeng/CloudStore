import { Injectable } from '@nestjs/common';

export type ExtractedTextKind = 'markdown' | 'text' | 'pdf';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractedDocument {
  kind: ExtractedTextKind;
  pages: ExtractedPage[];
}

@Injectable()
export class TextExtractor {
  async extract(buffer: Buffer, filename: string): Promise<ExtractedDocument> {
    const extension = filename.toLowerCase().split('.').pop() ?? '';
    if (extension === 'pdf') return this.extractPdf(buffer);
    if (extension === 'md') return this.fromText(buffer.toString('utf8'), 'markdown');
    return this.fromText(buffer.toString('utf8'), 'text');
  }

  private async fromText(text: string, kind: ExtractedTextKind): Promise<ExtractedDocument> {
    // 统一移除 UTF-8 BOM；Windows 导出的 txt 常见。
    const normalized = text.replace(/^\uFEFF/, '').trim();
    if (!normalized) throw new Error('文件中没有可索引的文本');
    return { kind, pages: [{ pageNumber: 1, text: normalized }] };
  }

  private async extractPdf(buffer: Buffer): Promise<ExtractedDocument> {
    // pdfjs 在 Node 中不使用浏览器 Worker；动态 import 避免所有非 PDF 上传承担启动成本。
    const pdfjs = (await import('pdfjs-dist')) as unknown as {
      getDocument: (options: Record<string, unknown>) => {
        promise: Promise<{
          numPages: number;
          getPage: (pageNumber: number) => Promise<{
            getTextContent: () => Promise<{ items: unknown[] }>;
          }>;
        }>;
      };
    };

    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useWorkerFetch: false,
      useSystemFonts: false,
    }).promise;

    const pages: ExtractedPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => {
          const value = item as { str?: unknown };
          return typeof value.str === 'string' ? value.str : '';
        })
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) pages.push({ pageNumber, text });
    }

    if (pages.length === 0) {
      throw new Error('PDF 中没有可提取的文本；扫描件需要 OCR');
    }
    return { kind: 'pdf', pages };
  }
}
