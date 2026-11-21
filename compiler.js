(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const D = root.QTREE_DATA;
  if (!D) throw new Error("QTREE_DATA missing");

  const ROUTE_KEYS = Object.keys(D.first);
  const ACTION_KEYS = ["check", "ask", "try", "rest"];
  const CRISIS_WORDS = ["自杀", "自残", "不想活", "想死", "结束生命", "活着没意思", "死了算了", "轻生"];

  const SOURCE_TAGS = {
    fit171: ["适合", "职业", "兴趣", "反复愿意做", "长期"],
    fit79: ["适合", "职业", "优势", "别人找你", "反馈"],
    fit33: ["方向", "尝试", "长期规划", "小步试", "不确定"],
    fit27: ["找工作", "条件", "经验", "快速", "盘点"],
    direction91: ["求职", "没回音", "简历", "降预期", "换赛道"],
    lost56: ["毕业", "迷茫", "焦虑", "市场", "家里"],
    lost35: ["没方向", "不知道能做什么", "起点", "焦虑"],
    switch24: ["转行", "没经验", "可迁移", "经验翻译"],
    switch17: ["转行", "没经验", "入口", "跨行业"],
    try28: ["试错", "深耕", "阶段", "成本", "怕选错"],
    try22: ["失业", "提不起劲", "拆小", "躺", "小问题"],
    try21: ["不喜欢", "瓶颈", "转行", "积累"],
    income12: ["收入", "成本", "退路", "留下", "走"],
    interview58: ["面试", "紧张", "大脑空白", "框架", "表达"]
  };

  const STOP_GRAMS = new Set([
    "什么", "怎么", "一个", "现在", "就是", "可以", "不知", "知道", "感觉", "觉得",
    "自己", "我的", "我是", "要不", "然后", "但是", "因为", "所以", "如果", "这个",
    "那个", "一下", "一点", "还是", "已经", "真的", "其实", "没有", "不是", "我们"
  ]);

  const SITUATION_LABELS = {
    study: "还在读书",
    job: "在找工作",
    work: "已经工作",
    other: "都不是"
  };

  const ACTION_LABELS = {
    check: "查一查",
    ask: "问个人",
    try: "试一次",
    rest: "先不动"
  };

  function clip(value, size) {
    const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    return Array.from(text).slice(0, size).join("");
  }

  function cleanText(value) {
    return String(value == null ? "" : value)
      .replace(/[，。！？、；：""''（）()《》【】\[\]{}<>·—…\s]/g, "")
      .toLowerCase();
  }

  function grams(value) {
    const text = cleanText(value);
    const set = new Set();
    for (let index = 0; index < text.length - 1; index += 1) {
      const gram = text.slice(index, index + 2);
      if (!STOP_GRAMS.has(gram)) set.add(gram);
    }
    return set;
  }

  function overlap(a, b) {
    let count = 0;
    a.forEach((item) => { if (b.has(item)) count += 1; });
    return count;
  }

  function hasCrisis(value) {
    return CRISIS_WORDS.some((word) => String(value || "").includes(word));
  }

  function detectSituation(text) {
    const value = String(text || "");
    if (/面试|紧张|大脑空白|自我介绍/.test(value)) return "job";
    if (/大三|大四|研一|研二|在读|读书|考研|保研|论文|专业课|学费|学校|实习/.test(value) && !/投简历|招聘|offer/i.test(value)) return "study";
    if (/找工作|求职|投简历|简历|offer|招聘|岗位|应届|毕业|没回音/i.test(value)) return "job";
    if (/上班|工作|转行|跳槽|辞职|老板|公司|工资|收入|晋升|同事|职场/.test(value)) return "work";
    return "other";
  }

  function detectBlocker(text, situation) {
    const value = String(text || "");
    if (/面试|紧张|大脑空白|自我介绍/.test(value)) return "interview";
    if (/没回音|没回复|石沉大海|已读不回|投了.*没|没人理/.test(value)) return "silence";
    if (/家里|父母|爸妈|催|反对|家人|长辈/.test(value)) return "family";
    if (/没经验|零经验|没有经验/.test(value)) return "experience";
    if (/收入|工资|降薪|钱|成本|学费|经济/.test(value)) {
      if (situation === "study") return "money";
      if (situation === "work") return "income";
      return "money";
    }
    if (/不知道能干嘛|能做什么|适合什么|不知道干什么|不知道做什么/.test(value)) {
      return situation === "work" ? "what" : "direction";
    }
    if (/怕选错|害怕|不敢|担心|恐惧/.test(value)) return "fear";
    if (/没劲|提不起|躺|摆烂|无聊/.test(value)) return "flat";
    if (/没人|孤独|一个人|没人问/.test(value)) return "alone";
    if (/时间|来不及|没空|拖/.test(value)) return "time";
    if (/迷茫|没方向|不知道|没底|慌/.test(value)) {
      if (situation === "study") return "unsure";
      if (situation === "job") return "direction";
      return "unclear";
    }
    return {
      study: "unsure",
      job: "direction",
      work: "what",
      other: "unclear"
    }[situation] || "unclear";
  }

  function validBlocker(situation, blocker) {
    const list = D.blockers[situation] || [];
    if (list.some((item) => item.id === blocker)) return blocker;
    return {
      study: "unsure",
      job: "direction",
      work: "what",
      other: "unclear"
    }[situation] || "unclear";
  }

  function detectAction(text) {
    const value = String(text || "");
    if (/先不动|休息|缓一缓|停一停|躺|放一放/.test(value)) return "rest";
    if (/问|聊|找人|咨询|前辈|过来人/.test(value)) return "ask";
    if (/试|投|做|开始|行动|实习|尝试/.test(value)) return "try";
    return "check";
  }

  function labelsFor(situation) {
    return (D.blockers[situation] || []).map((item) => ({ label: item.label, value: item.id }));
  }

  function questionSet(situation, blocker) {
    const q1Text = {
      study: "你现在最想先拆开哪一块？",
      job: "你现在卡在求职的哪一段？",
      work: "换与不换之间，你最想先动哪一块？",
      other: "你这句话里，最需要先看清楚的是哪一块？"
    }[situation];
    const q2Text = {
      study: {
        time: "时间不够，最卡你的是哪一块？",
        money: "钱不够，最卡你的是哪一块？",
        unsure: "心里没底，最卡你的是哪一块？",
        family: "家里不同意，最卡你的是哪一块？"
      },
      job: {
        silence: "投出去没回音，最卡你的是哪一段？",
        direction: "不知道往哪投，最卡你的是哪一块？",
        interview: "面试这一关，最卡你的是哪一段？",
        experience: "没经验，最卡你的是哪一段？"
      },
      work: {
        what: "不知道能干嘛，最卡你的是哪一块？",
        experience: "没经验，最卡你的是哪一块？",
        income: "收入会掉，最卡你的是哪一块？",
        family: "家里反对，最卡你的是哪一块？"
      },
      other: {
        unclear: "说不清，最卡你的是哪一块？",
        flat: "提不起劲，最卡你的是哪一块？",
        fear: "怕选错，最卡你的是哪一块？",
        alone: "没人问，最卡你的是哪一块？"
      }
    }[situation];
    const blockerLabel = (D.blockers[situation] || []).find((item) => item.id === blocker)?.label || "这件事";
    return [
      {
        id: "q1",
        text: q1Text,
        why: "先分清你站在哪一步，后面的问题才不会问偏。",
        options: D.situations.map((item) => ({ label: item.label, value: item.id }))
      },
      {
        id: "q2",
        text: (q2Text && q2Text[blocker]) || (situation === "study" ? "最卡你的是哪一样？" : "最卡你的是哪一样？"),
        why: "这一问是在找真正挡住你的东西，而不是再复述一遍焦虑。",
        options: labelsFor(situation)
      },
      {
        id: "q3",
        text: `今晚，关于「${blockerLabel}」，你愿意先做哪一件？`,
        why: "把问题收窄到今晚能做的一步，才不至于明天还在原地。",
        options: D.actions.map((item) => ({ label: item.label, value: item.id }))
      }
    ];
  }

  function branchSet(situation, blockerLabel) {
    const focus = clip(blockerLabel || SITUATION_LABELS[situation], 16);
    return {
      read: {
        q: `先读哪一条，能让你对「${focus}」少一点猜？`,
        why: "你选了更想读，说明现在缺的是可核对的真实经验，不是再想一遍。",
        keyword: `${focus} 真实经历`
      },
      work: {
        q: `先做哪一步，能最快验证「${focus}」？`,
        why: "你选了更想工作，说明你需要现实反馈，不是更多信息。",
        keyword: `${focus} 怎么开始`
      },
      same: {
        q: `还没变，先补哪一块关于「${focus}」的信息？`,
        why: "你还没变，先别逼自己选；先补一个能改变判断的事实。",
        keyword: `${focus} 怎么判断`
      }
    };
  }

  function thirdSet(situation, blockerLabel) {
    const focus = clip(blockerLabel || SITUATION_LABELS[situation], 16);
    return {
      check: {
        q: `查什么，能让你对「${focus}」更有底？`,
        why: "先查一个能被核对的事实，比继续想更有用。",
        keyword: `${focus} 真实情况`
      },
      ask: {
        q: "先问谁，能问出真实情况？",
        why: "找做过这件事的人问一个具体问题，比问十个泛问题有用。",
        keyword: `${focus} 过来人`
      },
      try: {
        q: "先试哪件小事，成本最低？",
        why: "先做一次小尝试，拿到反馈再决定要不要继续。",
        keyword: `${focus} 第一步`
      },
      rest: {
        q: "先不动，你需要确认什么？",
        why: "先不动不是逃避，是先把最怕的结果写清楚。",
        keyword: `${focus} 最怕什么`
      }
    };
  }

  function sourceScore(sourceId, focus, seed) {
    const source = D.sources[sourceId];
    if (!source) return -1;
    const tags = SOURCE_TAGS[sourceId] || [];
    const focusClean = cleanText(focus);
    const sourceClean = cleanText(`${source.title} ${source.gist} ${tags.join(" ")}`);
    const focusGrams = grams(focus);
    const sourceGrams = grams(`${source.title} ${source.gist} ${tags.join(" ")}`);
    let score = sourceId === seed ? 4 : 0;
    tags.forEach((tag) => {
      if (focusClean.includes(cleanText(tag))) score += 2;
    });
    score += overlap(focusGrams, sourceGrams);
    if (sourceClean.includes(focusClean) && focusClean.length >= 2) score += 2;
    return score;
  }

  function pickSource(focus, exclude, seed) {
    const blocked = new Set(exclude || []);
    let best = null;
    let bestScore = -1;
    Object.keys(D.sources).forEach((sourceId) => {
      if (blocked.has(sourceId)) return;
      const score = sourceScore(sourceId, focus, seed);
      if (score > bestScore || (score === bestScore && sourceId === seed)) {
        best = sourceId;
        bestScore = score;
      }
    });
    return best || Object.keys(D.sources).find((id) => !blocked.has(id)) || "fit33";
  }

  function reasonFor(sourceId, focus) {
    const source = D.sources[sourceId];
    if (!source) return "";
    return `这条在讲「${source.gist}」，和你说的「${clip(focus, 14)}」更接近。`;
  }

  function buildSourcePlan(routeKey, branch, actionKey, text, blockerLabel) {
    const firstSeed = (D.first[routeKey] || D.first["other|unclear"]).source;
    const firstId = pickSource(`${text} ${D.first[routeKey].q}`, [], firstSeed);
    const first = { source_id: firstId, reason: reasonFor(firstId, blockerLabel, "第一站") };
    const second = {};
    ["read", "work", "same"].forEach((key) => {
      const seed = (D.second[key] || D.second.read).source;
      const id = pickSource(`${text} ${branch[key].q} ${branch[key].keyword}`, [firstId], seed);
      second[key] = { source_id: id, reason: reasonFor(id, blockerLabel, "这一站") };
    });
    const third = {};
    const secondIds = [second.read.source_id, second.work.source_id, second.same.source_id];
    ["check", "ask", "try", "rest"].forEach((key) => {
      const seed = (D.third[key] || D.third.check).source;
      const id = pickSource(`${text} ${key} ${blockerLabel}`, [firstId, ...secondIds], seed);
      third[key] = { source_id: id, reason: reasonFor(id, blockerLabel, "最后一站") };
    });
    return { first, second, third };
  }

  function tonightAction(actionKey, blockerLabel, situation) {
    const focus = clip(blockerLabel, 16);
    if (actionKey === "check") {
      if (situation === "study") return `今晚花 15 分钟，查一个你想去的专业或实习岗位的真实要求，记下 3 条。`;
      if (situation === "job") return `今晚花 15 分钟，挑 1 个目标岗位，抄下 3 条硬要求。`;
      if (situation === "work") return `今晚花 15 分钟，查 1 个目标岗位的招聘要求，和现在的工作对比 3 条。`;
      return `今晚花 15 分钟，查一个和「${focus}」有关的具体要求，记下 3 条事实。`;
    }
    if (actionKey === "ask") {
      return `今晚找一个做过这件事的人，问一个和「${focus}」有关的具体问题。`;
    }
    if (actionKey === "try") {
      if (situation === "job") return `今晚改 1 段简历，投 1 个最匹配的岗位，只记录反馈。`;
      if (situation === "study") return `今晚花 15 分钟做 1 次小尝试：听 1 节课、做 1 道题，或问 1 个人。`;
      return `今晚做一件 15 分钟能完成的小尝试，只记录感受，不急着下结论。`;
    }
    if (actionKey === "rest") {
      return `今晚先不做决定，写下你最怕发生的那个结果。`;
    }
    return `今晚先写下你对「${focus}」最不确定的一点。`;
  }

  function searchTerms(situation, blockerLabel) {
    const focus = clip(blockerLabel, 14);
    return [
      `${focus} 真实经历`,
      `${SITUATION_LABELS[situation]} ${focus} 怎么判断`,
      `${focus} 第一步`
    ];
  }

  function compileLocal(text) {
    const raw = clip(text, 80);
    const situation = detectSituation(raw);
    const blocker = validBlocker(situation, detectBlocker(raw, situation));
    const routeKey = D.first[`${situation}|${blocker}`] ? `${situation}|${blocker}` : "other|unclear";
    const actionKey = detectAction(raw);
    const blockerLabel = (D.blockers[situation] || []).find((item) => item.id === blocker)?.label || "这件事";
    const questions = questionSet(situation, blocker);
    const branch = branchSet(situation, blockerLabel);
    const third = thirdSet(situation, blockerLabel);
    const sourcePlan = buildSourcePlan(routeKey, branch, actionKey, raw, blockerLabel);
    return {
      mode: "offline",
      situation: raw,
      stuck_point: blockerLabel,
      constraints: [],
      fear: "",
      time_window: "今晚",
      tonight_action: tonightAction(actionKey, blockerLabel, situation),
      route_key: routeKey,
      action_key: actionKey,
      questions,
      branch_questions: branch,
      third_questions: third,
      source_plan: sourcePlan,
      search_terms: searchTerms(situation, blockerLabel)
    };
  }

  function normalizeQuestions(value, fallback) {
    if (!Array.isArray(value) || value.length !== 3) return null;
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (!item || typeof item !== "object") return null;
      const text = clip(item.text || item.q, 60);
      const why = clip(item.why || item.reason, 50);
      if (!text || !why) return null;
      const options = Array.isArray(item.options) ? item.options : [];
      if (options.length < 3) return null;
      const normalized = options.slice(0, 4).map((option, optionIndex) => {
        if (typeof option === "string") return { label: clip(option, 18), value: `m${optionIndex}` };
        const label = clip(option && (option.label || option.text), 18);
        if (!label) return null;
        return { label, value: clip(option.value || `m${optionIndex}`, 20) };
      }).filter(Boolean);
      if (normalized.length < 3) return null;
      result.push({
        id: clip(item.id || `q${index + 1}`, 8),
        text,
        why,
        options: normalized
      });
    }
    return result;
  }

  function normalizeBranch(value, fallback) {
    const result = {};
    for (const key of ["read", "work", "same"]) {
      const item = value && value[key];
      if (!item || typeof item !== "object") return null;
      const q = clip(item.q || item.text, 60);
      const why = clip(item.why || item.reason, 50);
      const keyword = clip(item.keyword, 20);
      if (!q || !why || !keyword) return null;
      result[key] = { q, why, keyword };
    }
    return result;
  }

  function normalizeThird(value, fallback) {
    const result = {};
    for (const key of ACTION_KEYS) {
      const item = value && value[key];
      if (!item || typeof item !== "object") return null;
      const q = clip(item.q || item.text, 60);
      const why = clip(item.why || item.reason, 50);
      const keyword = clip(item.keyword, 20);
      if (!q || !why || !keyword) return null;
      result[key] = { q, why, keyword };
    }
    return result;
  }

  function normalizeTerms(value, fallback) {
    if (!Array.isArray(value)) return fallback;
    const terms = value.map((item) => clip(item, 24)).filter(Boolean).slice(0, 3);
    return terms.length === 3 ? terms : fallback;
  }

  function choosePlanSource(candidate, fallbackId, focus, exclude, prefix) {
    const blocked = new Set(exclude || []);
    const chosen = typeof candidate === "string" && D.sources[candidate] && !blocked.has(candidate)
      ? candidate
      : (fallbackId && !blocked.has(fallbackId) ? fallbackId : pickSource(focus, exclude, fallbackId));
    return { source_id: chosen, reason: reasonFor(chosen, focus, prefix) };
  }

  function normalizeSourceIds(value, fallback, text, blockerLabel) {
    if (!value || typeof value !== "object") return fallback;
    const firstId = value.first;
    if (!D.sources[firstId]) return fallback;
    const first = choosePlanSource(firstId, fallback.first.source_id, blockerLabel, [], "第一站");
    const second = {};
    const secondValue = value.second || {};
    ["read", "work", "same"].forEach((key) => {
      const candidate = secondValue[key];
      second[key] = choosePlanSource(candidate, fallback.second[key].source_id, blockerLabel, [first.source_id], "这一站");
    });
    const third = {};
    const thirdValue = value.third || {};
    const secondIds = [second.read.source_id, second.work.source_id, second.same.source_id];
    ACTION_KEYS.forEach((key) => {
      const candidate = thirdValue[key];
      third[key] = choosePlanSource(candidate, fallback.third[key].source_id, blockerLabel, [first.source_id, ...secondIds], "最后一站");
    });
    return { first, second, third };
  }

  function specificEnough(value, minLength) {
    const text = String(value || "").trim();
    const length = Array.from(text).length;
    if (length < (minLength || 8)) return false;
    // 只拦“短且以泛问开头”的问法；长问句即使以“你更想/你最近”开头，也可能已经很具体。
    if (length < 14 && /^(你(是否|有没有|最近|愿意|更想)|是否|哪些|如何|是否可以)/.test(text)) return false;
    return true;
  }

  function normalizeModel(raw, text, fallback) {
    if (hasCrisis(raw && JSON.stringify(raw))) return { ok: false, reason: "unsafe_output" };
    const candidate = raw && typeof raw === "object" && raw.session ? raw.session : raw;
    if (!candidate || typeof candidate !== "object") return { ok: false, reason: "not_object" };
    const questions = normalizeQuestions(candidate.questions, fallback.questions);
    if (!questions) return { ok: false, reason: "bad_questions" };
    const branch = normalizeBranch(candidate.branch_questions, fallback.branch_questions);
    if (!branch) return { ok: false, reason: "bad_branch" };
    const third = normalizeThird(candidate.third_questions, fallback.third_questions) || fallback.third_questions;
    const routeKey = fallback.route_key;
    const actionKey = fallback.action_key;
    const blockerLabel = clip(candidate.stuck_point, 20) || fallback.stuck_point;
    const modelQuestionsOk = questions.every((item) => specificEnough(item.text, 8));
    const modelBranchOk = ["read", "work", "same"].every((key) => specificEnough(branch[key].q, 8));
    const modelThirdOk = ACTION_KEYS.every((key) => specificEnough(third[key].q, 8));
    const modelTonightOk = specificEnough(candidate.tonight_action, 10);
    const useModelPlan = modelQuestionsOk && modelBranchOk && modelThirdOk;
    return {
      ok: true,
      session: {
        mode: useModelPlan ? "model" : "offline",
        situation: clip(candidate.situation, 80) || fallback.situation,
        stuck_point: blockerLabel,
        constraints: Array.isArray(candidate.constraints) ? candidate.constraints.map((item) => clip(item, 12)).filter(Boolean).slice(0, 3) : fallback.constraints,
        fear: clip(candidate.fear, 40) || fallback.fear,
        time_window: clip(candidate.time_window, 20) || fallback.time_window,
        tonight_action: modelTonightOk ? clip(candidate.tonight_action, 50) : fallback.tonight_action,
        route_key: routeKey,
        action_key: actionKey,
        questions: useModelPlan ? questions : fallback.questions,
        branch_questions: useModelPlan ? branch : fallback.branch_questions,
        third_questions: useModelPlan ? third : fallback.third_questions,
        source_plan: fallback.source_plan,
        search_terms: fallback.search_terms
      }
    };
  }

  function sourceCatalog() {
    return Object.keys(D.sources).map((id) => ({
      id,
      title: D.sources[id].title,
      gist: D.sources[id].gist,
      tags: SOURCE_TAGS[id] || []
    }));
  }

  function buildPrompt(text) {
    const sourceJson = JSON.stringify(sourceCatalog());
    return [
      "你是「问题树」的编译器，不替用户回答，只把一句模糊处境编译成可以搜索、可以问人、可以行动的问题。",
      "只输出一个 JSON 对象，不要 Markdown，不要代码块，不要解释。",
      "所有字段必须存在。不要诊断，不要承诺结果，不要写空话。",
      "禁止泛问：不要问“你是否清楚自己的优势”“你有没有遇到问题”“你是否考虑过调整方向”这类空问题。",
      "每一问都必须出现用户原话里的具体对象或具体动作，例如“投了三个月没回音”“家里催考研”“面试一开口就空白”。",
      "questions 必须是 3 道有 3 到 4 个短选项的选择题，不是“是/否”二选一。",
      "第一问问现在最具体的一步；第二问问最具体的阻力；第三问问今晚 15 分钟能做的动作。",
      "",
      "字段要求：",
      "- situation：用 1 句话复述用户处境，不超过 40 字。",
      "- stuck_point：真正的卡点，不超过 20 字。",
      "- constraints：最多 3 个现实约束，每个不超过 12 字。",
      "- fear：最怕发生的结果，不超过 30 字。",
      "- time_window：时间窗口，例如“今晚”“这周”。",
      "- tonight_action：一条今晚 15 分钟内能做完的具体动作，不超过 40 字。",
      `- route_key：必须从这些键里选一个：${ROUTE_KEYS.join("、")}`,
      "  对应示例：投简历没回音=job|silence；面试紧张=job|interview；家里催考研=study|family；转行怕收入掉=work|income；不知道能干什么=job|direction 或 other|unclear。",
      "- action_key：必须是 check、ask、try、rest 之一。",
      "- questions：3 个问题，必须一问比一问更窄。每题有 id、text、why、options；why 是一句“为什么问这个”，不超过 24 字；options 为 3 到 4 个对象，每个有 label 和 value，label 不超过 10 字。",
      "- branch_questions：必须包含 read、work、same 三套第二站问题；每套有 q、why、keyword；q 不超过 40 字，why 不超过 24 字，keyword 不超过 14 字。read 对应“更想读”，work 对应“更想工作”，same 对应“还没变”。",
      "  work 的第二站必须是一个具体动作，例如“先投哪一类岗位/先改哪一段简历”，不要复述“更想工作还是继续寻找”。",
      "- third_questions：必须包含 check、ask、try、rest 四套第三站问题；每套有 q、why、keyword。",
      "- source_ids：从下面的来源目录里选真实 id。first 选 1 个；second 的 read/work/same 各选 1 个；third 的 check/ask/try/rest 各选 1 个。不要编造 id。",
      "- search_terms：正好 3 个搜索词，每个不超过 20 字，分别对应三问。",
      "",
      "来源目录：",
      sourceJson,
      "",
      "用户原话：",
      `"""${clip(text, 80)}"""`,
      "",
      "JSON 形状示例（只示例结构，值必须按用户处境重新生成）：",
      '{"situation":"...","stuck_point":"...","constraints":["..."],"fear":"...","time_window":"...","tonight_action":"...","route_key":"job|direction","action_key":"check","questions":[{"id":"q1","text":"...","why":"...","options":[{"label":"...","value":"a"},{"label":"...","value":"b"},{"label":"...","value":"c"}]},{"id":"q2","text":"...","why":"...","options":[{"label":"...","value":"a"},{"label":"...","value":"b"},{"label":"...","value":"c"}]},{"id":"q3","text":"...","why":"...","options":[{"label":"...","value":"a"},{"label":"...","value":"b"},{"label":"...","value":"c"}]}],"branch_questions":{"read":{"q":"...","why":"...","keyword":"..."},"work":{"q":"...","why":"...","keyword":"..."},"same":{"q":"...","why":"...","keyword":"..."}},"third_questions":{"check":{"q":"...","why":"...","keyword":"..."},"ask":{"q":"...","why":"...","keyword":"..."},"try":{"q":"...","why":"...","keyword":"..."},"rest":{"q":"...","why":"...","keyword":"..."}},"source_ids":{"first":"fit79","second":{"read":"fit171","work":"fit79","same":"try28"},"third":{"check":"fit27","ask":"lost35","try":"try28","rest":"try22"}},"search_terms":["...","...","..."]}'
    ].join("\n");
  }

  const api = {
    ROUTE_KEYS,
    ACTION_KEYS,
    SOURCE_TAGS,
    compileLocal,
    normalizeModel,
    buildPrompt,
    sourceCatalog,
    questionSet,
    reasonFor,
    pickSource,
    hasCrisis,
    clip,
    detectSituation,
    detectBlocker,
    detectAction
  };

  root.QTreeCompiler = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
