'use strict';
// ===== AIによる問題生成（Claude API をブラウザから直接呼び出す） =====
// APIキーはこの端末の localStorage にだけ保存され、エクスポートや同期には含まれません。

const AI_SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.5.0/+esm';

const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5（高品質・おすすめ）' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5（バランス）' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5（高速・低コスト）' },
];

const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['choice', 'text'] },
          question: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' } },
          answer_index: { type: 'integer' },
          answer_text: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: ['type', 'question', 'choices', 'answer_index', 'answer_text', 'explanation'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

const AI = {
  _sdk: null,

  async sdk() {
    if (!this._sdk) this._sdk = (await import(AI_SDK_URL)).default;
    return this._sdk;
  },

  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  },

  async buildContent({ text, files }) {
    const content = [];
    const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    for (const f of files) {
      if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: await this.fileToBase64(f) },
          title: f.name,
        });
      } else if (imageTypes.includes(f.type)) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: f.type, data: await this.fileToBase64(f) },
        });
      } else {
        content.push({ type: 'text', text: `【資料: ${f.name}】\n${await f.text()}` });
      }
    }
    if (text.trim()) content.push({ type: 'text', text: `【ノート】\n${text.trim()}` });
    return content;
  },

  /**
   * 資料から問題を生成する。
   * @returns {Promise<Array>} アプリ形式の問題配列（id/stats は未設定）
   */
  async generate({ apiKey, model, subjectName, text, files, count, kind, difficulty, onProgress }) {
    const Anthropic = await this.sdk();
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

    const material = await this.buildContent({ text, files });
    if (!material.length) throw new Error('ノートを入力するか、ファイルを選択してください');

    const kindText = {
      choice: 'すべて4択の選択式問題',
      text: 'すべて一問一答の記述式問題（答えは単語や短い語句）',
      mix: '選択式と記述式を半分ずつ程度',
    }[kind];
    const diffText = { basic: '基礎（用語の定義・基本事項の確認）', standard: '標準（定期試験レベル）', hard: '応用（理解や計算・比較を問う）' }[difficulty];

    const instructions = `科目「${subjectName}」の定期試験対策として、上の資料の内容から問題を${count}問作ってください。

- 形式: ${kindText}
- 難易度: ${diffText}
- 資料に書かれている内容だけを根拠にし、資料にないことは出題しない
- 資料の重要事項をまんべんなく扱い、同じ内容の問題を重複させない
- 選択式: choices に4つの選択肢を入れ、正解の位置（0始まり）を answer_index に入れる。誤答はもっともらしいものにする。answer_text は空文字
- 記述式: choices は空配列、answer_index は -1、answer_text に正解を入れる。表記ゆれや別解は「|」で区切って並べる（例: 分散|variance）
- explanation には、なぜその答えになるのかを資料に沿って1〜3文で書く
- 数式は LaTeX で書き、インラインは $...$、独立した式は $$...$$ で囲む
- 資料と同じ言語で書く`;

    const params = {
      model,
      max_tokens: 32000,
      system: 'あなたは大学の定期試験の問題を作る、経験豊富な教員です。学生が試験前に理解度を確認できる、正確で良質な問題を作ります。',
      messages: [{ role: 'user', content: [...material, { type: 'text', text: instructions }] }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: QUESTION_SCHEMA } },
    };
    // 安全性判定で断られた場合に別モデルで自動再実行する（Haiku は非対応）
    if (!model.startsWith('claude-haiku')) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }

    let message;
    try {
      const stream = client.beta.messages.stream(params);
      let received = 0;
      stream.on('text', (delta) => { received += delta.length; onProgress && onProgress(received); });
      message = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new Error('APIキーが正しくありません。設定画面で確認してください。');
      if (err instanceof Anthropic.PermissionDeniedError) throw new Error('このAPIキーではこのモデルを使えません。');
      if (err instanceof Anthropic.RateLimitError) throw new Error('利用上限に達しました。少し待ってから再度お試しください。');
      if (err instanceof Anthropic.BadRequestError) throw new Error('リクエストが受け付けられませんでした（ファイルが大きすぎる可能性があります）: ' + err.message);
      if (err instanceof Anthropic.APIConnectionError) throw new Error('Claude API に接続できませんでした。ネット接続を確認してください。');
      if (err instanceof Anthropic.APIError) throw new Error(`Claude API エラー (${err.status ?? '不明'}): ${err.message}`);
      throw err;
    }

    if (message.stop_reason === 'refusal') throw new Error('この資料からは問題を作成できませんでした（安全性の判定により停止）。');
    if (message.stop_reason === 'max_tokens') throw new Error('出力が長すぎて途中で切れました。問題数を減らして再度お試しください。');

    const json = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let data;
    try { data = JSON.parse(json); } catch (e) { throw new Error('AIの出力を読み取れませんでした。もう一度お試しください。'); }

    return (data.questions || []).map((q) => {
      if (q.type === 'choice') {
        const choices = (q.choices || []).map((c) => String(c).trim()).filter(Boolean);
        if (choices.length < 2 || q.answer_index < 0 || q.answer_index >= choices.length) return null;
        return { type: 'choice', question: q.question.trim(), choices, answer: q.answer_index, explanation: q.explanation.trim() };
      }
      if (!q.answer_text || !q.answer_text.trim()) return null;
      return { type: 'text', question: q.question.trim(), answer: q.answer_text.trim(), explanation: q.explanation.trim() };
    }).filter((q) => q && q.question);
  },
};
