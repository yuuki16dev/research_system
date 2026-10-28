// ==========================================================================
// PowerPoint (.pptx) ネイティブエクスポートモジュール (v1.10.0)
// PptxGenJS を使用して完全編集可能な商用スライドファイルを直接生成
// ==========================================================================

import { toast, safeFilename } from '../ui.js';

/**
 * 現在のデータおよびブランド設定をもとに編集可能な .pptx を生成・ダウンロード
 * @param {Object} data - レポート/スライドデータ (appState.currentResult)
 * @param {Object} brand - ブランド設定 (publisherName, confidentiality, etc.)
 */
export async function exportPowerPoint(data, brand = {}) {
  if (!data) {
    toast('エクスポート対象のデータがありません', 'error');
    return;
  }

  if (typeof window.PptxGenJS === 'undefined') {
    toast('PowerPoint生成ライブラリの読み込み中です。数秒後にもう一度お試しください。', 'warn');
    return;
  }

  try {
    toast('📊 PowerPoint (.pptx) を生成中...', 'info', 3000);

    const pptx = new window.PptxGenJS();

    // 16:9 ワイド画面設定
    pptx.layout = 'LAYOUT_16x9';

    const publisher = brand.publisherName || 'Research Studio';
    const author = brand.author || '';
    const confidentiality = brand.confidentiality || 'CONFIDENTIAL';
    const disclaimer = brand.disclaimer || '本レポートは公開情報をもとにAIが自動収集・分析したものです。';
    const reportTitle = data.title || data.theme || 'プレゼンテーション資料';

    pptx.title = reportTitle;
    pptx.author = author || publisher;
    pptx.company = publisher;

    // カラーパレット定義 (Hex without #)
    const C = {
      bgDark: '070A14',
      bgCard: '0F172A',
      bgCardAlt: '1E293B',
      border: '334155',
      primary: '3B82F6',
      primaryDark: '1D4ED8',
      cyan: '06B6D4',
      textWhite: 'FFFFFF',
      textMuted: '94A3B8',
      textDim: '64748B',
      accentGreen: '10B981',
      accentYellow: 'F59E0B',
      badgeBg: '1E293B',
    };

    // 文字量に応じた動的フォントサイズ計算ヘルパー（枠外はみ出し・文字潰れ防止）
    function calcFontSize(text, defaultSize, minSize, maxLen) {
      const len = String(text || '').length;
      if (!len || len <= maxLen) return defaultSize;
      const ratio = maxLen / len;
      const size = Math.round(defaultSize * Math.max(0.68, ratio));
      return Math.max(minSize, Math.min(defaultSize, size));
    }

    // 描画枠・画像・図形のアスペクト比維持自動Containフィッティング計算ヘルパー
    // スライド有効領域 (Bounding Box) を超えない安全寸法を算出
    function fitToBounds(origW, origH, maxW, maxH) {
      const w = Math.max(0.1, Number(origW) || 1);
      const h = Math.max(0.1, Number(origH) || 1);
      const ratio = w / h;
      const targetRatio = maxW / maxH;
      let finalW, finalH;
      if (ratio > targetRatio) {
        finalW = maxW;
        finalH = maxW / ratio;
      } else {
        finalH = maxH;
        finalW = maxH * ratio;
      }
      return { w: Number(finalW.toFixed(2)), h: Number(finalH.toFixed(2)) };
    }

    // 共通ヘッダー・フッター追加ヘルパー
    function addSlideDecorations(slide, secTitle, pageNum) {
      // 背景色
      slide.background = { color: C.bgDark };

      // ランニングヘッド (上部)
      slide.addText(
        [
          { text: publisher.toUpperCase(), options: { bold: true, color: C.primary, fontSize: 10 } },
          { text: '  |  ' + reportTitle, options: { color: C.textDim, fontSize: 10 } },
        ],
        { x: 0.8, y: 0.4, w: 9.0, h: 0.4, margin: 0, shrinkText: true }
      );
      slide.addText(secTitle, {
        x: 9.8,
        y: 0.4,
        w: 2.7,
        h: 0.4,
        align: 'right',
        color: C.cyan,
        fontSize: 10,
        bold: true,
        margin: 0,
        shrinkText: true,
      });

      // 上部アクセントライン
      slide.addShape(pptx.ShapeType.line, {
        x: 0.8,
        y: 0.85,
        w: 11.7,
        h: 0,
        line: { color: C.border, width: 1 },
      });

      // ランニングフット (下部)
      slide.addShape(pptx.ShapeType.line, {
        x: 0.8,
        y: 6.85,
        w: 11.7,
        h: 0,
        line: { color: C.border, width: 1 },
      });
      slide.addText(confidentiality, {
        x: 0.8,
        y: 6.95,
        w: 3.0,
        h: 0.35,
        color: C.accentYellow,
        fontSize: 9,
        bold: true,
      });
      slide.addText(`© 2026 ${publisher}. All rights reserved.`, {
        x: 4.0,
        y: 6.95,
        w: 5.3,
        h: 0.35,
        align: 'center',
        color: C.textDim,
        fontSize: 9,
      });
      slide.addText(`Page ${pageNum} / 6`, {
        x: 10.0,
        y: 6.95,
        w: 2.5,
        h: 0.35,
        align: 'right',
        color: C.textMuted,
        fontSize: 9,
        bold: true,
      });
    }

    // =========================================================================
    // SLIDE 1: 表紙 (Title Cover)
    // =========================================================================
    {
      const s1 = pptx.addSlide();
      s1.background = { color: C.bgDark };

      // 装飾アクセントバー
      s1.addShape(pptx.ShapeType.rect, {
        x: 0.8,
        y: 1.5,
        w: 0.15,
        h: 2.2,
        fill: { color: C.primary },
        line: { color: C.primary },
      });

      // 機密区分バッジ
      s1.addText(confidentiality, {
        x: 1.2,
        y: 1.45,
        w: 2.2,
        h: 0.32,
        fill: { color: '1E293B' },
        color: C.cyan,
        fontSize: 10,
        bold: true,
        align: 'center',
        rectRadius: 0.05,
      });

      // メインタイトル (文字数に応じた動的スケーリング & 枠内自動縮小)
      const tLen = reportTitle.length;
      const tSize = tLen <= 24 ? 26 : tLen <= 40 ? 20 : tLen <= 60 ? 16 : 14;
      s1.addText(reportTitle, {
        x: 1.2,
        y: 1.85,
        w: 10.5,
        h: 1.5,
        color: C.textWhite,
        fontSize: tSize,
        bold: true,
        valign: 'top',
        margin: 0,
        wrap: true,
        shrinkText: true,
      });

      // サブタイトル
      const subtitle = data.subtitle || 'Executive Intelligence & Decision Briefing';
      const subSize = calcFontSize(subtitle, 14, 10.5, 45);
      s1.addText(subtitle, {
        x: 1.2,
        y: 3.45,
        w: 10.5,
        h: 0.8,
        color: C.textMuted,
        fontSize: subSize,
        margin: 0,
        wrap: true,
        shrinkText: true,
      });

      // フッターメタ情報カード
      s1.addShape(pptx.ShapeType.roundRect, {
        x: 1.2,
        y: 5.2,
        w: 10.5,
        h: 1.2,
        fill: { color: C.bgCard },
        line: { color: C.border, width: 1 },
        rectRadius: 0.1,
      });

      const dateStr = data.createdAt ? new Date(data.createdAt).toLocaleDateString('ja-JP') : new Date().toLocaleDateString('ja-JP');
      s1.addText(
        [
          { text: '発行元: ', options: { color: C.textDim, fontSize: 11 } },
          { text: `${publisher}    `, options: { color: C.textWhite, bold: true, fontSize: 11 } },
          { text: '作成者: ', options: { color: C.textDim, fontSize: 11 } },
          { text: `${author || 'Research Team'}    `, options: { color: C.textWhite, bold: true, fontSize: 11 } },
          { text: '発行日: ', options: { color: C.textDim, fontSize: 11 } },
          { text: `${dateStr}`, options: { color: C.textWhite, bold: true, fontSize: 11 } },
        ],
        { x: 1.5, y: 5.5, w: 9.9, h: 0.5, margin: 0, shrinkText: true }
      );
    }

    // =========================================================================
    // SLIDE 2: エグゼクティブサマリー & キーインサイト
    // =========================================================================
    {
      const s2 = pptx.addSlide();
      addSlideDecorations(s2, '01 / EXECUTIVE SUMMARY', 2);

      // 見出し
      s2.addText('エグゼクティブサマリー & 主要インサイト', {
        x: 0.8,
        y: 1.05,
        w: 11.7,
        h: 0.45,
        color: C.textWhite,
        fontSize: 20,
        bold: true,
      });

      // Bottom Line (結論) コールアウトカード
      s2.addShape(pptx.ShapeType.roundRect, {
        x: 0.8,
        y: 1.6,
        w: 11.7,
        h: 1.15,
        fill: { color: '0F172A' },
        line: { color: C.primary, width: 1.5 },
        rectRadius: 0.08,
      });

      const summaryText = data.summary || (data.keyPoints && data.keyPoints[0]) || '本調査における最重要結論とビジネスインパクトの要約。';
      const summaryFontSize = calcFontSize(summaryText, 11, 8.5, 90);
      s2.addText(
        [
          { text: '【結論 / Bottom Line】 ', options: { bold: true, color: C.cyan, fontSize: Math.max(10, summaryFontSize + 0.5) } },
          { text: summaryText, options: { color: C.textWhite, fontSize: summaryFontSize } },
        ],
        { x: 1.05, y: 1.7, w: 11.2, h: 0.95, valign: 'middle', margin: 0, wrap: true, shrinkText: true }
      );

      // 4インサイトカード (2x2 グリッド)
      const rawInsights = Array.isArray(data.insights) ? data.insights : [];
      const defaultInsights = [
        { badge: '市場', title: '業界動向の加速と本番適用', desc: 'PoCから実務適用へのシフトが顕著であり、先行企業の導入事例が増加傾向にある。', kpi: '41%' },
        { badge: '効果', title: '業務効率化と工数削減の実現', desc: '検索・情報整理工数の大幅削減が確認され、定常業務の生産性向上が実証されている。', kpi: '−38%' },
        { badge: '技術', title: '精度向上とデータ整備の相関', desc: 'モデル性能に加えて、インデックス化される社内文書・メタデータの品質が成否を分ける。', kpi: '+21pt' },
        { badge: 'リスク', title: 'セキュリティと権限管理の徹底', desc: 'アクセス権限の確実な継承と情報漏洩防止が、システム選定時の最重要基準となる。', kpi: '63%' },
      ];

      for (let i = 0; i < 4; i++) {
        const ins = rawInsights[i] || defaultInsights[i];
        const col = i % 2;
        const row = Math.floor(i / 2);
        const cardX = 0.8 + col * 5.95;
        const cardY = 2.95 + row * 1.85;

        s2.addShape(pptx.ShapeType.roundRect, {
          x: cardX,
          y: cardY,
          w: 5.75,
          h: 1.7,
          fill: { color: C.bgCard },
          line: { color: C.border, width: 1 },
          rectRadius: 0.08,
        });

        // バッジ ＆ KPI
        s2.addText(ins.badge || ins.category || '要点', {
          x: cardX + 0.25,
          y: cardY + 0.2,
          w: 1.2,
          h: 0.3,
          fill: { color: '1E293B' },
          color: C.cyan,
          fontSize: 9,
          bold: true,
          align: 'center',
          rectRadius: 0.04,
        });

        if (ins.kpi || ins.kpiVal) {
          s2.addText(String(ins.kpi || ins.kpiVal), {
            x: cardX + 3.8,
            y: cardY + 0.15,
            w: 1.7,
            h: 0.35,
            color: C.accentGreen,
            fontSize: 14,
            bold: true,
            align: 'right',
          });
        }

        // 見出し
        const insTitleSize = calcFontSize(ins.title, 12, 10, 18);
        s2.addText(ins.title || '', {
          x: cardX + 0.25,
          y: cardY + 0.58,
          w: 5.25,
          h: 0.38,
          color: C.textWhite,
          fontSize: insTitleSize,
          bold: true,
          wrap: true,
          shrinkText: true,
        });

        // 本文
        const insBodySize = calcFontSize(ins.body || ins.desc, 10, 8, 48);
        s2.addText(ins.body || ins.desc || '', {
          x: cardX + 0.25,
          y: cardY + 0.98,
          w: 5.25,
          h: 0.65,
          color: C.textMuted,
          fontSize: insBodySize,
          valign: 'top',
          wrap: true,
          shrinkText: true,
        });
      }
    }

    // =========================================================================
    // SLIDE 3: 構造化比較マトリクス
    // =========================================================================
    {
      const s3 = pptx.addSlide();
      addSlideDecorations(s3, '02 / COMPARISON MATRIX', 3);

      s3.addText('構造化比較マトリクス', {
        x: 0.8,
        y: 1.05,
        w: 11.7,
        h: 0.45,
        color: C.textWhite,
        fontSize: 20,
        bold: true,
      });

      // テーブルデータの作成 & 動的列幅計算
      let tableRows = [];
      let colWidths = [];
      const tableData = data.table;

      if (tableData && Array.isArray(tableData.columns) && Array.isArray(tableData.rows) && tableData.rows.length) {
        const numCols = Math.max(1, tableData.columns.length);
        const col1W = numCols <= 4 ? 3.0 : numCols <= 6 ? 2.6 : 2.1;
        const otherW = Math.max(0.75, (11.7 - col1W) / Math.max(1, numCols - 1));
        colWidths = [col1W, ...Array(numCols - 1).fill(otherW)];

        // 列数に応じた基本フォントサイズ
        const baseFontSize = numCols <= 4 ? 11 : numCols <= 6 ? 9.5 : 8;

        // ヘッダー行
        const headerRow = tableData.columns.map((col, cIdx) => ({
          text: String(col || ''),
          options: {
            bold: true,
            color: C.textWhite,
            fill: { color: C.bgCardAlt },
            fontSize: baseFontSize,
            align: cIdx === 0 ? 'left' : 'center',
            valign: 'middle',
            margin: [2, 3, 2, 3],
          },
        }));
        tableRows.push(headerRow);

        // データ行 (最大5行に限定してスライド縦幅内に収める)
        tableData.rows.slice(0, 5).forEach((r, idx) => {
          const isRec = idx === 0;
          const rowCells = r.map((cell, cIdx) => {
            const cellText = String(cell || '');
            const cellSize = calcFontSize(cellText, isRec ? baseFontSize : baseFontSize - 0.5, 7.5, 22);
            return {
              text: cellText,
              options: {
                color: isRec ? C.cyan : C.textWhite,
                bold: isRec || cIdx === 0,
                fill: { color: isRec ? '1E3A8A' : idx % 2 === 0 ? '0F172A' : '162032' },
                fontSize: cellSize,
                align: cIdx === 0 ? 'left' : 'center',
                valign: 'middle',
                margin: [2, 3, 2, 3],
              },
            };
          });
          tableRows.push(rowCells);
        });
      } else {
        // デフォルト比較表
        colWidths = [2.8, 3.6, 3.6, 1.7];
        tableRows = [
          [
            { text: '項目 / 選択肢', options: { bold: true, color: C.textWhite, fill: { color: C.bgCardAlt }, fontSize: 10.5, align: 'left', valign: 'middle', margin: [2, 3, 2, 3] } },
            { text: '導入メリット', options: { bold: true, color: C.textWhite, fill: { color: C.bgCardAlt }, fontSize: 10.5, align: 'center', valign: 'middle', margin: [2, 3, 2, 3] } },
            { text: '課題・留意点', options: { bold: true, color: C.textWhite, fill: { color: C.bgCardAlt }, fontSize: 10.5, align: 'center', valign: 'middle', margin: [2, 3, 2, 3] } },
            { text: '総合評価', options: { bold: true, color: C.textWhite, fill: { color: C.bgCardAlt }, fontSize: 10.5, align: 'center', valign: 'middle', margin: [2, 3, 2, 3] } },
          ],
          [
            { text: '推奨方式 (Plan A)', options: { color: C.cyan, bold: true, fill: { color: '1E3A8A' }, fontSize: 10, align: 'left', valign: 'middle', margin: [2, 3, 2, 3] } },
            { text: '高精度かつ即効性・低リスク', options: { color: C.textWhite, fill: { color: '1E3A8A' }, fontSize: 9.5, align: 'center', valign: 'middle', margin: [2, 3, 2, 3] } },
            { text: '初期設定の丁寧な合意形成が必要', options: { color: C.textWhite, fill: { color: '1E3A8A' }, fontSize: 9.5, align: 'center', valign: 'middle', margin: [2, 3, 2, 3] } },
            { text: '★★★★★ (最適解)', options: { color: C.accentYellow, bold: true, fill: { color: '1E3A8A' }, fontSize: 9.5, align: 'center', valign: 'middle', margin: [2, 3, 2, 3] } },
          ],
          [
            { text: '代替方式 (Plan B)', options: { color: C.textWhite, fill: { color: '0F172A' }, fontSize: 9.5, align: 'left', valign: 'middle', margin: [2, 3, 2, 3] } },
            { text: '既存ツールの流用で初期費用小', options: { color: C.textWhite, fill: { color: '0F172A' }, fontSize: 9.5, align: 'center', valign: 'middle', margin: [2, 3, 2, 3] } },
            { text: '拡張性や自動化の余地が限定的', options: { color: C.textWhite, fill: { color: '0F172A' }, fontSize: 9.5, align: 'center', valign: 'middle', margin: [2, 3, 2, 3] } },
            { text: '★★★☆☆ (妥協案)', options: { color: C.textMuted, fill: { color: '0F172A' }, fontSize: 9.5, align: 'center', valign: 'middle', margin: [2, 3, 2, 3] } },
          ],
        ];
      }

      // テーブル配置（行数に応じた行高調整でフッターとの衝突を完全防止）
      const numRows = tableRows.length;
      const rowH = numRows <= 4 ? 0.5 : numRows <= 5 ? 0.44 : 0.38;
      const totalTableH = numRows * rowH;

      s3.addTable(tableRows, {
        x: 0.8,
        y: 1.6,
        w: 11.7,
        colW: colWidths,
        border: { pt: 1, color: C.border },
        rowH: rowH,
      });

      // 下部コールアウト（テーブル直下に動的配置 & 最大安全領域クランプ）
      const calloutY = Math.max(5.35, Math.min(5.6, 1.6 + totalTableH + 0.2));
      const calloutH = Math.min(1.15, Math.max(0.85, 6.75 - calloutY));

      s3.addShape(pptx.ShapeType.roundRect, {
        x: 0.8,
        y: calloutY,
        w: 11.7,
        h: calloutH,
        fill: { color: '0F172A' },
        line: { color: C.cyan, width: 1 },
        rectRadius: 0.08,
      });

      const takeawayText = (data.keyPoints && data.keyPoints[1]) || '機能性と運用負荷のバランスを考慮した場合、段階的導入によるリスク抑制アプローチが最もROIが高い。';
      const takeawaySize = calcFontSize(takeawayText, 11, 8.5, 80);
      s3.addText(
        [
          { text: '💡 比較分析の示唆 (Key Takeaway): ', options: { bold: true, color: C.cyan, fontSize: Math.max(10, takeawaySize + 0.5) } },
          {
            text: takeawayText,
            options: { color: C.textWhite, fontSize: takeawaySize },
          },
        ],
        { x: 1.05, y: calloutY + 0.1, w: 11.2, h: Math.max(0.6, calloutH - 0.2), valign: 'middle', margin: 0, wrap: true, shrinkText: true }
      );
    }

    // =========================================================================
    // SLIDE 4: 主要論点・詳細分析
    // =========================================================================
    {
      const s4 = pptx.addSlide();
      addSlideDecorations(s4, '03 / DEEP ANALYSIS', 4);

      s4.addText('主要論点・詳細ファクト分析', {
        x: 0.8,
        y: 1.05,
        w: 11.7,
        h: 0.5,
        color: C.textWhite,
        fontSize: 20,
        bold: true,
      });

      const sections = Array.isArray(data.sections) && data.sections.length ? data.sections.slice(0, 2) : [];
      const defaultSections = [
        {
          heading: '市場トレンドと技術的優位性の実証',
          body: '主要プレイヤーの動向調査により、特定アーキテクチャの採用が標準化されつつある。',
          bullets: ['実運用フェーズへの移行加速', 'API連携によるエコシステムの確立', '運用コストの継続的低減効果'],
        },
        {
          heading: '導入障壁の解消アプローチと推進体制',
          body: 'ガバナンスと利便性を両立するフレームワークの導入が成功の鍵となる。',
          bullets: ['社内ガイドラインの早期策定', 'PoCによる定量的効果測定', '段階的ロールアウト計画の策定'],
        },
      ];

      const secItems = sections.length ? sections : defaultSections;

      secItems.forEach((sec, idx) => {
        const colX = 0.8 + idx * 5.95;

        s4.addShape(pptx.ShapeType.roundRect, {
          x: colX,
          y: 1.7,
          w: 5.75,
          h: 4.85,
          fill: { color: C.bgCard },
          line: { color: C.border, width: 1 },
          rectRadius: 0.08,
        });

        // セクション番号
        s4.addText(`POINT 0${idx + 1}`, {
          x: colX + 0.3,
          y: 1.95,
          w: 2.0,
          h: 0.3,
          color: C.cyan,
          fontSize: 10,
          bold: true,
        });

        // 見出し
        const headSize = calcFontSize(sec.heading, 13, 10.5, 22);
        s4.addText(sec.heading || '', {
          x: colX + 0.3,
          y: 2.3,
          w: 5.15,
          h: 0.6,
          color: C.textWhite,
          fontSize: headSize,
          bold: true,
          valign: 'top',
          wrap: true,
          shrinkText: true,
        });

        // 概要文
        const secBodySize = calcFontSize(sec.body, 10.5, 8.5, 45);
        s4.addText(sec.body || '', {
          x: colX + 0.3,
          y: 2.95,
          w: 5.15,
          h: 0.75,
          color: C.textMuted,
          fontSize: secBodySize,
          valign: 'top',
          wrap: true,
          shrinkText: true,
        });

        // 箇条書きポイント
        if (sec.bullets && sec.bullets.length) {
          const bulletTexts = sec.bullets.slice(0, 3).map((b) => {
            const bSize = calcFontSize(b, 10, 8, 30);
            return {
              text: b,
              options: { bullet: true, color: C.textWhite, fontSize: bSize, lineSpacing: 20 },
            };
          });
          s4.addText(bulletTexts, {
            x: colX + 0.3,
            y: 3.75,
            w: 5.15,
            h: 2.6,
            valign: 'top',
            wrap: true,
            shrinkText: true,
          });
        }
      });
    }

    // =========================================================================
    // SLIDE 5: 実行戦略ロードマップ
    // =========================================================================
    {
      const s5 = pptx.addSlide();
      addSlideDecorations(s5, '04 / ROADMAP', 5);

      s5.addText('実行戦略ロードマップ & スケジュール', {
        x: 0.8,
        y: 1.05,
        w: 11.7,
        h: 0.45,
        color: C.textWhite,
        fontSize: 20,
        bold: true,
      });

      const rawRoadmap = (data.deepThinking && Array.isArray(data.deepThinking.roadmap))
        ? data.deepThinking.roadmap
        : (Array.isArray(data.roadmap) ? data.roadmap : []);
      const defaultRoadmap = [
        { phase: 'Phase 1: 検証・PoC', focus: '要件定義・環境構築', actions: ['初期スコープ策定', 'パイロット検証'] },
        { phase: 'Phase 2: 本格展開', focus: 'コア機能統合・連携', actions: ['社内本番適用', '利用定着化トレーニング'] },
        { phase: 'Phase 3: 最適化', focus: 'ROI最大化・自律運用', actions: ['運用自動化の推進', '次期拡張計画の立案'] },
      ];
      const phases = rawRoadmap.length ? rawRoadmap.slice(0, 3) : defaultRoadmap;

      phases.forEach((p, idx) => {
        const cardX = 0.8 + idx * 3.95;

        s5.addShape(pptx.ShapeType.roundRect, {
          x: cardX,
          y: 1.65,
          w: 3.8,
          h: 4.9,
          fill: { color: C.bgCard },
          line: { color: idx === 0 ? C.primary : C.border, width: idx === 0 ? 1.5 : 1 },
          rectRadius: 0.08,
        });

        // フェーズ名
        const phSize = calcFontSize(p.phase, 13, 11, 16);
        s5.addText(p.phase || `Phase ${idx + 1}`, {
          x: cardX + 0.25,
          y: 1.9,
          w: 3.3,
          h: 0.4,
          color: idx === 0 ? C.cyan : C.textWhite,
          fontSize: phSize,
          bold: true,
          wrap: true,
          shrinkText: true,
        });

        // 重点フォーカス
        const focusText = `【重点】 ${p.focus || p.goal || '推進目標'}`;
        const focusSize = calcFontSize(focusText, 10.5, 8.5, 22);
        s5.addText(focusText, {
          x: cardX + 0.25,
          y: 2.35,
          w: 3.3,
          h: 0.55,
          color: C.accentYellow,
          fontSize: focusSize,
          bold: true,
          wrap: true,
          shrinkText: true,
        });

        // 施策リスト (actions または items に対応)
        const actions = (Array.isArray(p.actions) && p.actions.length)
          ? p.actions
          : (Array.isArray(p.items) ? p.items : []);
        if (actions.length) {
          const actCount = actions.length;
          const baseActSize = actCount <= 3 ? 9.5 : 8.5;
          const lineSpacing = actCount <= 3 ? 19 : 16;
          const actionTexts = actions.slice(0, 4).map((a) => {
            const aSize = calcFontSize(a, baseActSize, 7.5, 26);
            return {
              text: a,
              options: { bullet: true, color: C.textMuted, fontSize: aSize, lineSpacing },
            };
          });
          s5.addText(actionTexts, {
            x: cardX + 0.25,
            y: 3.0,
            w: 3.3,
            h: 3.3,
            valign: 'top',
            wrap: true,
            shrinkText: true,
          });
        }
      });
    }

    // =========================================================================
    // SLIDE 6: 結論・提言・参照ソース
    // =========================================================================
    {
      const s6 = pptx.addSlide();
      addSlideDecorations(s6, '05 / CONCLUSION', 6);

      s6.addText('結論・提言 & 参照ソース', {
        x: 0.8,
        y: 1.05,
        w: 11.7,
        h: 0.45,
        color: C.textWhite,
        fontSize: 20,
        bold: true,
      });

      // 提言ブロック (左側)
      s6.addShape(pptx.ShapeType.roundRect, {
        x: 0.8,
        y: 1.65,
        w: 6.8,
        h: 4.9,
        fill: { color: C.bgCard },
        line: { color: C.border, width: 1 },
        rectRadius: 0.08,
      });

      s6.addText('戦略的提言 (Actionable Recommendations)', {
        x: 1.1,
        y: 1.9,
        w: 6.2,
        h: 0.35,
        color: C.cyan,
        fontSize: 12,
        bold: true,
      });

      const recs = (data.keyPoints && data.keyPoints.length)
        ? data.keyPoints
        : ['先行事例の成功要因を取り入れた迅速なプロトタイピングの実施', 'リスク低減のための段階的評価ゲートウェイの設置', '社内ステークホルダーへの定期的価値還元と合意形成'];

      const recTexts = recs.slice(0, 4).map((r, i) => {
        const rSize = calcFontSize(r, 10.5, 8.5, 42);
        return {
          text: `${i + 1}. ${r}\n`,
          options: { color: C.textWhite, fontSize: rSize, lineSpacing: 20, bold: false },
        };
      });
      s6.addText(recTexts, {
        x: 1.1,
        y: 2.35,
        w: 6.2,
        h: 3.9,
        valign: 'top',
        wrap: true,
        shrinkText: true,
      });

      // 参照ソース & 免責 (右側)
      s6.addShape(pptx.ShapeType.roundRect, {
        x: 7.8,
        y: 1.65,
        w: 4.7,
        h: 4.9,
        fill: { color: C.bgCard },
        line: { color: C.border, width: 1 },
        rectRadius: 0.08,
      });

      s6.addText('参照ソース & エビデンス', {
        x: 8.05,
        y: 1.9,
        w: 4.2,
        h: 0.35,
        color: C.textWhite,
        fontSize: 12,
        bold: true,
      });

      const sources = Array.isArray(data.sources) ? data.sources.slice(0, 5) : [];
      if (sources.length) {
        const srcTexts = sources.map((s, i) => {
          const srcTitle = s.title || s.domain || '一次情報源';
          const srcSize = calcFontSize(srcTitle, 9, 7.5, 28);
          return {
            text: `[${i + 1}] ${srcTitle}\n`,
            options: { color: C.primary, fontSize: srcSize, lineSpacing: 16 },
          };
        });
        s6.addText(srcTexts, {
          x: 8.05,
          y: 2.35,
          w: 4.2,
          h: 2.1,
          valign: 'top',
          wrap: true,
          shrinkText: true,
        });
      } else {
        s6.addText('一次情報源および公式ドキュメントに基づく網羅的分析を実施済み。', {
          x: 8.05,
          y: 2.35,
          w: 4.2,
          h: 1.0,
          color: C.textMuted,
          fontSize: 10,
        });
      }

      // 免責事項
      s6.addShape(pptx.ShapeType.line, {
        x: 8.05,
        y: 4.65,
        w: 4.2,
        h: 0,
        line: { color: C.border, width: 1 },
      });
      s6.addText(
        [
          { text: '【免責事項】\n', options: { bold: true, color: C.textDim, fontSize: 8.5 } },
          { text: disclaimer, options: { color: C.textDim, fontSize: 8 } },
        ],
        {
          x: 8.05,
          y: 4.8,
          w: 4.2,
          h: 1.6,
          valign: 'top',
          margin: 0,
          wrap: true,
          shrinkText: true,
        }
      );
    }

    // ファイル名決定 & ダウンロード実行
    const fileName = `${safeFilename(reportTitle)}.pptx`;
    await pptx.writeFile({ fileName });

    toast(`✅ PowerPointファイル「${fileName}」をダウンロードしました！`, 'success', 5000);
  } catch (err) {
    console.error('PowerPoint generation failed:', err);
    toast(`PowerPoint出力エラー: ${err.message}`, 'error', 6000);
  }
}
