(() => {
  "use strict";

  const D = window.QTREE_DATA;
  const Compiler = window.QTreeCompiler;
  const LLM = window.QTreeLLM;
  const $ = (id) => document.getElementById(id);
  const screens = {
    entry: $("screen-entry"),
    q1: $("screen-q1"),
    q2: $("screen-q2"),
    q3: $("screen-q3"),
    route: $("screen-route"),
    feedback: $("screen-feedback"),
    takeaway: $("screen-takeaway"),
    shared: $("screen-shared")
  };

  const state = {
    text: "",
    session: null,
    mode: "offline",
    reason: "",
    answers: [],
    questionIndex: 0,
    routeKey: "other|unclear",
    actionKey: "check",
    second: "read",
    stage: 0,
    screen: "entry",
    shared: null,
    metrics: {},
    revisitSaved: false
  };

  const METRICS_KEY = "qtreeMetricsV1";
  const REVISIT_KEY = "qtreeRevisitV1";
  const UNSAID_KEY = "qtreeUnsaidV1";

  let toastTimer = null;

  function hasCrisis(text) {
    return (Compiler && Compiler.hasCrisis ? Compiler.hasCrisis(text) : false) ||
      ["自杀", "自残", "不想活", "想死", "结束生命", "活着没意思", "死了算了", "轻生"].some((word) => text.includes(word));
  }

  function setScreen(name) {
    state.screen = name;
    Object.entries(screens).forEach(([key, element]) => {
      element.classList.toggle("active", key === name);
    });

    const progress = {
      entry: null,
      q1: 1,
      q2: 2,
      q3: 3,
      route: 4,
      feedback: 4,
      takeaway: 4,
      shared: null
    }[name];

    const dots = $("dots");
    dots.dataset.visible = ["entry", "shared"].includes(name) ? "false" : "true";
    document.querySelectorAll(".dot").forEach((dot) => {
      const index = Number(dot.dataset.dot);
      dot.classList.toggle("filled", !!progress && index < progress);
      dot.classList.toggle("current", !!progress && index === progress && name !== "route" && name !== "feedback" && name !== "takeaway");
    });

    const back = $("back");
    back.dataset.visible = ["q1", "q2", "q3"].includes(name) ? "true" : "false";
    back.textContent = name === "q1" ? "返回" : "上一步";

    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function readStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function defaultMetrics() {
    return {
      starts: 0,
      completions: 0,
      routeViews: 0,
      routeExpands: 0,
      sourceSessions: 0,
      sourceClicks: 0,
      shareLinks: 0,
      imageExports: 0,
      revisitViews: 0,
      revisitActed: 0,
      revisitNot: 0,
      unsaidLocal: 0,
      unsaidAnon: 0
    };
  }

  function readMetrics() {
    const value = readStorage(METRICS_KEY, null);
    const base = defaultMetrics();
    if (!value || typeof value !== "object") return base;
    Object.keys(base).forEach((key) => {
      const number = Number(value[key]);
      if (Number.isFinite(number) && number >= 0) base[key] = Math.floor(number);
    });
    return base;
  }

  function writeMetrics(value) {
    return writeStorage(METRICS_KEY, value);
  }

  function bump(name, amount) {
    const metrics = readMetrics();
    metrics[name] = (Number(metrics[name]) || 0) + (amount || 1);
    writeMetrics(metrics);
  }

  function markOnce(name) {
    if (state.metrics[name]) return;
    state.metrics[name] = true;
    bump(name);
  }

  function metricRate(part, total) {
    if (!total) return "0%";
    return `${Math.round((part / total) * 100)}%`;
  }

  function clipText(value, max) {
    return Compiler && Compiler.clip ? Compiler.clip(value, max) : String(value || "").trim().slice(0, max);
  }

  function saveRevisitSnapshot() {
    if (state.shared || state.revisitSaved) return;
    const snapshot = {
      v: 1,
      createdAt: Date.now(),
      questions: getTakeQuestions(),
      terms: getSearchTerms(),
      action: getTonightAction(),
      mode: state.mode
    };
    if (writeStorage(REVISIT_KEY, snapshot)) state.revisitSaved = true;
  }

  function loadRevisit() {
    const snapshot = readStorage(REVISIT_KEY, null);
    if (!snapshot || !Array.isArray(snapshot.questions) || snapshot.questions.length !== 3) return;
    const createdAt = Number(snapshot.createdAt);
    if (!Number.isFinite(createdAt)) return;
    const ageDays = Math.floor((Date.now() - createdAt) / 86400000);
    if (ageDays < 7 || snapshot.response || snapshot.dismissedAt) return;

    $("revisitMeta").textContent = `第 ${ageDays} 天 · ${new Date(createdAt).toLocaleDateString("zh-CN")}`;
    const list = $("revisitList");
    list.replaceChildren();
    snapshot.questions.forEach((question) => {
      const item = document.createElement("li");
      item.textContent = clipText(question, 100);
      list.appendChild(item);
    });
    $("revisitCard").hidden = false;
    if (!snapshot.viewedAt) {
      snapshot.viewedAt = Date.now();
      writeStorage(REVISIT_KEY, snapshot);
      bump("revisitViews");
    }
  }

  function answerRevisit(status) {
    const snapshot = readStorage(REVISIT_KEY, null);
    if (!snapshot) return;
    snapshot.response = status;
    snapshot.respondedAt = Date.now();
    writeStorage(REVISIT_KEY, snapshot);
    bump(status === "acted" ? "revisitActed" : "revisitNot");
    $("revisitCard").hidden = true;
    showToast(status === "acted" ? "记下了，继续走" : "记下了，下次再动");
  }

  function dismissRevisit() {
    const snapshot = readStorage(REVISIT_KEY, null);
    if (!snapshot) return;
    snapshot.dismissedAt = Date.now();
    writeStorage(REVISIT_KEY, snapshot);
    $("revisitCard").hidden = true;
  }

  function encodeCard(value) {
    const text = JSON.stringify(value);
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeCard(value) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function getCardData() {
    if (state.shared) return state.shared;
    return {
      meta: D.meta.verifiedAt,
      questions: getTakeQuestions(),
      terms: getSearchTerms(),
      action: getTonightAction(),
      mode: state.mode
    };
  }

  function sharePayload() {
    const data = getCardData();
    return {
      v: 1,
      t: data.meta,
      q: data.questions,
      s: data.terms,
      a: data.action,
      m: data.mode === "model" ? "m" : "o"
    };
  }

  function shareUrl() {
    return `${location.origin}${location.pathname}#card=${encodeCard(sharePayload())}`;
  }

  function renderSharedCard() {
    const data = state.shared;
    if (!data) return;
    $("sharedMeta").textContent = `别人分享的问题卡 · ${data.meta} · ${data.mode === "model" ? "模型路线" : "离线路线"}`;
    const list = $("sharedList");
    list.replaceChildren();
    data.questions.forEach((question) => {
      const item = document.createElement("li");
      item.textContent = question;
      list.appendChild(item);
    });
    const terms = $("sharedTerms");
    terms.replaceChildren();
    data.terms.forEach((term) => {
      const item = document.createElement("li");
      item.textContent = term;
      terms.appendChild(item);
    });
    $("sharedAction").textContent = data.action;
  }

  function loadSharedFromHash() {
    const match = /^#card=([^&]+)/.exec(location.hash);
    if (!match) return false;
    try {
      const parsed = JSON.parse(decodeCard(decodeURIComponent(match[1])));
      const questions = (Array.isArray(parsed.q) ? parsed.q : []).map((item) => clipText(item, 100)).filter(Boolean).slice(0, 3);
      const terms = (Array.isArray(parsed.s) ? parsed.s : []).map((item) => clipText(item, 40)).filter(Boolean).slice(0, 3);
      if (questions.length !== 3 || terms.length !== 3) return false;
      state.shared = {
        meta: clipText(parsed.t, 20) || D.meta.verifiedAt,
        questions,
        terms,
        action: clipText(parsed.a, 80) || "今晚先写下你最不确定的一点。",
        mode: parsed.m === "m" ? "model" : "offline"
      };
      renderSharedCard();
      setScreen("shared");
      return true;
    } catch (error) {
      return false;
    }
  }

  function openUnsaid() {
    $("unsaidText").value = "";
    $("unsaidMode").value = "local";
    updateUnsaidNote();
    $("unsaidModal").hidden = false;
  }

  function closeUnsaid() {
    $("unsaidModal").hidden = true;
  }

  function updateUnsaidNote() {
    $("unsaidNote").textContent = $("unsaidMode").value === "anonymous"
      ? "匿名提交：只发送这句话和时间，不带设备信息、不公开、不进入统计；提交后无法撤回。"
      : "只存本机：文字留在浏览器 localStorage，不发出任何请求。";
  }

  function unsaidEndpoint() {
    const endpoint = (window.QTREE_CONFIG && window.QTREE_CONFIG.endpoint) || "";
    return endpoint.replace(/\/api\/compile$/, "/api/unsaid");
  }

  function saveUnsaid() {
    const text = $("unsaidText").value.trim();
    if (!text) {
      showToast("先写一句，再决定放在哪里");
      $("unsaidText").focus();
      return;
    }
    if (hasCrisis(text)) {
      closeUnsaid();
      $("crisis").hidden = false;
      return;
    }
    if ($("unsaidMode").value === "local") {
      const list = readStorage(UNSAID_KEY, []);
      const items = Array.isArray(list) ? list : [];
      items.unshift({ text: text.slice(0, 200), createdAt: Date.now() });
      writeStorage(UNSAID_KEY, items.slice(0, 20));
      bump("unsaidLocal");
      closeUnsaid();
      showToast("只留在这台设备上");
      return;
    }

    const endpoint = unsaidEndpoint();
    if (!endpoint) {
      showToast("匿名接收端没接上，先选只存本机");
      return;
    }
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 200) })
    }).then((response) => {
      if (!response.ok) throw new Error("unsaid_failed");
      bump("unsaidAnon");
      closeUnsaid();
      showToast("已匿名提交，不会公开");
    }).catch(() => {
      showToast("匿名提交没成功，先选只存本机");
    });
  }

  function renderStats() {
    const metrics = readMetrics();
    const rows = [
      ["三问完成率", metricRate(metrics.completions, metrics.starts), `${metrics.completions} / ${metrics.starts}`],
      ["路线展开率", metricRate(metrics.routeExpands, metrics.routeViews), `${metrics.routeExpands} / ${metrics.routeViews}`],
      ["来源点击率", metricRate(metrics.sourceSessions, metrics.routeViews), `${metrics.sourceSessions} / ${metrics.routeViews}`],
      ["开始次数", String(metrics.starts), "本地记录"],
      ["分享链接", String(metrics.shareLinks), "复制次数"],
      ["图片导出", String(metrics.imageExports), "下载次数"],
      ["七天回访", `${metrics.revisitActed} 动 / ${metrics.revisitNot} 未动`, `${metrics.revisitViews} 次查看`],
      ["没问出口", `${metrics.unsaidLocal} 本机 / ${metrics.unsaidAnon} 匿名`, "只记次数"]
    ];
    const grid = $("statsGrid");
    grid.replaceChildren();
    rows.forEach(([label, value, detail]) => {
      const row = document.createElement("div");
      row.className = "stats-row";
      const labelEl = document.createElement("span");
      labelEl.className = "stats-label";
      labelEl.textContent = label;
      const valueEl = document.createElement("span");
      valueEl.className = "stats-value";
      valueEl.textContent = value;
      const detailEl = document.createElement("span");
      detailEl.className = "stats-detail";
      detailEl.textContent = detail;
      valueEl.appendChild(detailEl);
      row.appendChild(labelEl);
      row.appendChild(valueEl);
      grid.appendChild(row);
    });
  }

  function openStats() {
    renderStats();
    $("statsModal").hidden = false;
  }

  function closeStats() {
    $("statsModal").hidden = true;
  }

  function getLabels() {
    const qLabels = state.answers.map((item) => item.label).filter(Boolean);
    return {
      situation: qLabels[0] || "",
      blocker: qLabels[1] || (state.session ? state.session.stuck_point : ""),
      action: qLabels[2] || ""
    };
  }

  function renderOptions(container, items, onPick, className) {
    container.replaceChildren();
    (items || []).forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className || "option";
      button.textContent = item.label;
      button.addEventListener("click", () => onPick(item));
      container.appendChild(button);
    });
  }

  function renderQuestion(index) {
    const question = state.session && state.session.questions[index];
    if (!question) return;
    state.questionIndex = index;
    const number = index + 1;
    const quote = index === 0
      ? `「${state.text}」`
      : `上一题：${state.answers[index - 1] ? state.answers[index - 1].label : ""}`;
    $(`q${number}Quote`).textContent = quote;
    $(`q${number}Title`).textContent = question.text;
    $(`q${number}Why`).textContent = `为什么问这个：${question.why}`;
    renderOptions($(`q${number}Options`), question.options, (item) => {
      chooseAnswer(index, item);
    });
    setScreen(`q${number}`);
  }

  function chooseAnswer(index, item) {
    state.answers[index] = item;
    state.answers.length = index + 1;

    if (index === 0 && state.session.mode === "offline" && D.situations.some((situation) => situation.id === item.value)) {
      const defaultBlocker = { study: "unsure", job: "direction", work: "what", other: "unclear" }[item.value];
      const set = Compiler.questionSet(item.value, defaultBlocker);
      state.session.questions[1] = set[1];
    }

    if (index < 2) {
      renderQuestion(index + 1);
      return;
    }
    finishQuestions();
  }

  function resolveRouteKey() {
    const first = state.answers[0] && state.answers[0].value;
    const second = state.answers[1] && state.answers[1].value;
    if (D.situations.some((situation) => situation.id === first) &&
        (D.blockers[first] || []).some((blocker) => blocker.id === second)) {
      return `${first}|${second}`;
    }
    return state.session.route_key || "other|unclear";
  }

  function resolveActionKey() {
    const third = state.answers[2] && state.answers[2].value;
    return Compiler.ACTION_KEYS.includes(third) ? third : (state.session.action_key || "check");
  }

  function finishQuestions() {
    state.routeKey = resolveRouteKey();
    state.actionKey = resolveActionKey();
    state.stage = 0;
    state.second = "read";
    markOnce("completions");
    renderRoute();
    setScreen("route");
  }

  function getSource(sourceId) {
    return D.sources[sourceId] || null;
  }

  function makeLink(label, href, className, trackSource) {
    const link = document.createElement("a");
    link.textContent = label;
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (className) link.className = className;
    if (trackSource) {
      link.addEventListener("click", () => {
        markOnce("sourceSessions");
        bump("sourceClicks");
      });
    }
    return link;
  }

  function makeStationHead(number, timeLabel, status) {
    const head = document.createElement("div");
    head.className = "station-head";

    const label = document.createElement("span");
    label.className = "station-label";
    label.textContent = `第 ${number} 站 · ${timeLabel}`;
    head.appendChild(label);

    const stateLabel = document.createElement("span");
    stateLabel.className = "station-state";
    stateLabel.textContent = {
      current: "当前",
      done: "已读",
      locked: "未开"
    }[status];
    head.appendChild(stateLabel);

    return head;
  }

  function stationSource(plan, baseSource, alt, exclude) {
    const used = new Set(exclude || []);
    if (plan && D.sources[plan.source_id] && !used.has(plan.source_id)) {
      return { source: plan.source_id, reason: plan.reason || Compiler.reasonFor(plan.source_id, state.session.stuck_point, "这一站") };
    }
    if (D.sources[baseSource] && !used.has(baseSource)) {
      return { source: baseSource, reason: plan && plan.reason ? plan.reason : Compiler.reasonFor(baseSource, state.session.stuck_point, "这一站") };
    }
    const altId = (alt || []).find((sourceId) => D.sources[sourceId] && !used.has(sourceId));
    if (altId) {
      return { source: altId, reason: Compiler.reasonFor(altId, state.session.stuck_point, "这一站") };
    }
    const picked = Compiler.pickSource(state.text, [...used], baseSource);
    return { source: picked, reason: Compiler.reasonFor(picked, state.session.stuck_point, "这一站") };
  }

  function getFirstItem() {
    const base = D.first[state.routeKey] || D.first["other|unclear"];
    const plan = state.session.source_plan && state.session.source_plan.first;
    const picked = stationSource(plan, base.source, [], []);
    return { ...base, source: picked.source, reason: picked.reason };
  }

  function getSecondItem() {
    const base = D.second[state.second] || D.second.read;
    const branch = state.session.branch_questions && state.session.branch_questions[state.second];
    const first = getFirstItem();
    const plan = state.session.source_plan && state.session.source_plan.second && state.session.source_plan.second[state.second];
    const picked = stationSource(plan, base.source, D.secondAlt[state.second] || [], [first.source]);
    return {
      ...base,
      q: branch ? branch.q : base.q,
      keyword: branch ? branch.keyword : base.keyword,
      source: picked.source,
      reason: picked.reason
    };
  }

  function getThirdItem() {
    const base = D.third[state.actionKey] || D.third.check;
    const third = state.session.third_questions && state.session.third_questions[state.actionKey];
    const first = getFirstItem();
    const second = getSecondItem();
    const plan = state.session.source_plan && state.session.source_plan.third && state.session.source_plan.third[state.actionKey];
    const picked = stationSource(plan, base.source, D.thirdAlt[state.actionKey] || [], [first.source, second.source]);
    return {
      ...base,
      q: third ? third.q : base.q,
      keyword: third ? third.keyword : base.keyword,
      source: picked.source,
      reason: picked.reason
    };
  }

  function renderStation(number, timeLabel, routeItem, status) {
    const station = document.createElement("article");
    station.className = `station ${status}`;

    station.appendChild(makeStationHead(number, timeLabel, status));

    if (status === "locked") {
      station.setAttribute("aria-disabled", "true");
      const preview = document.createElement("h3");
      preview.className = "station-preview";
      preview.textContent = routeItem.q;
      station.appendChild(preview);
      return station;
    }

    const source = getSource(routeItem.source);
    if (!source) return station;

    const question = document.createElement("h3");
    question.textContent = routeItem.q;
    station.appendChild(question);

    const answer = document.createElement("div");
    answer.className = "answer-box";

    const top = document.createElement("div");
    top.className = "answer-topline";

    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = source.kind === "article" ? "文章" : "回答";
    top.appendChild(tag);

    const title = makeLink(source.title, source.url, "answer-title", true);
    top.appendChild(title);
    answer.appendChild(top);

    const meta = document.createElement("p");
    meta.className = "answer-meta";
    meta.textContent = `${source.votes} 赞同 · ${source.date}`;
    answer.appendChild(meta);

    const gist = document.createElement("p");
    gist.className = "gist";
    gist.textContent = `在讲：${source.gist}`;
    answer.appendChild(gist);

    if (routeItem.reason) {
      const reason = document.createElement("p");
      reason.className = "station-reason";
      reason.textContent = `为什么适合你：${routeItem.reason}`;
      answer.appendChild(reason);
    }

    const read = makeLink("读这条 →", source.url, "readline", true);
    answer.appendChild(read);
    station.appendChild(answer);

    if (source.threadUrl && source.threadTitle) {
      const links = document.createElement("div");
      links.className = "station-links";
      links.appendChild(makeLink("看这个问题下的回答 →", source.threadUrl, "", true));
      links.appendChild(makeLink(`搜索「${routeItem.keyword}」→`, searchUrl(routeItem.keyword)));
      station.appendChild(links);
    } else {
      const links = document.createElement("div");
      links.className = "station-links";
      links.appendChild(makeLink(`搜索「${routeItem.keyword}」→`, searchUrl(routeItem.keyword)));
      station.appendChild(links);
    }

    if (status === "current") {
      const next = document.createElement("button");
      next.type = "button";
      next.className = "station-next";
      next.textContent = number === 3 ? "看完了，收下这三个问题" : "看完了，下一步";
      next.addEventListener("click", () => {
        if (state.stage === 0) {
          renderFeedback();
          setScreen("feedback");
          return;
        }
        if (state.stage === 1) {
          state.stage = 2;
          renderRoute();
          setScreen("route");
          return;
        }
        renderTakeaway();
        setScreen("takeaway");
      });
      station.appendChild(next);
    }

    return station;
  }

  function searchUrl(keyword) {
    return `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(keyword)}`;
  }

  function renderRoute() {
    const labels = getLabels();
    $("routeContext").textContent = `你走到这里：${labels.situation} · ${labels.blocker} · ${labels.action}`;
    const mode = state.mode === "model" ? "模型路线" : "离线路线";
    $("routeMeta").textContent = `检索 ${D.meta.verifiedAt} · ${D.meta.sourceCount} 条可核验回答 · ${mode}`;
    markOnce("routeViews");

    const first = getFirstItem();
    const second = getSecondItem();
    const third = getThirdItem();
    const statuses = state.stage === 0
      ? ["current", "locked", "locked"]
      : state.stage === 1
        ? ["done", "current", "locked"]
        : ["done", "done", "current"];

    const stations = $("stations");
    stations.replaceChildren();
    stations.appendChild(renderStation(1, "今天", first, statuses[0]));
    stations.appendChild(renderStation(2, "这周", second, statuses[1]));
    stations.appendChild(renderStation(3, "定下来之前", third, statuses[2]));
  }

  function renderFeedback() {
    $("feedbackQuote").textContent = "";
    $("feedbackQuote").style.display = "none";
    const container = $("feedbackOptions");
    container.replaceChildren();
    [
      { id: "read", label: "更想读" },
      { id: "work", label: "更想工作" },
      { id: "same", label: "还没变" }
    ].forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "feedback-option";
      button.textContent = item.label;
      button.addEventListener("click", () => {
        state.second = item.id;
        state.stage = 1;
        markOnce("routeExpands");
        renderRoute();
        setScreen("route");
      });
      container.appendChild(button);
    });
  }

  function getTakeQuestions() {
    return [getFirstItem().q, getSecondItem().q, getThirdItem().q];
  }

  function getSearchTerms() {
    const terms = state.session && state.session.search_terms;
    if (terms && terms.length === 3) return terms;
    const focus = (state.session && state.session.stuck_point) || "这件事";
    return [`${focus} 真实经历`, `${focus} 怎么判断`, `${focus} 第一步`];
  }

  function getTonightAction() {
    return (state.session && state.session.tonight_action) || "今晚先写下你最不确定的一点。";
  }

  function renderTakeaway() {
    const mode = state.mode === "model" ? " · 模型路线" : " · 离线路线";
    $("takeMeta").textContent = `3 个问题 · 3 个搜索词 · 1 个今晚动作 · ${D.meta.verifiedAt}${mode}`;
    const list = $("takeList");
    list.replaceChildren();
    getTakeQuestions().forEach((question) => {
      const item = document.createElement("li");
      item.textContent = question;
      list.appendChild(item);
    });
    const terms = $("searchTerms");
    terms.replaceChildren();
    getSearchTerms().forEach((term) => {
      const item = document.createElement("li");
      item.textContent = term;
      terms.appendChild(item);
    });
    $("tonightAction").textContent = getTonightAction();
    saveRevisitSnapshot();
  }

  function resetToEntry() {
    state.text = "";
    state.session = null;
    state.mode = "offline";
    state.reason = "";
    state.answers = [];
    state.questionIndex = 0;
    state.routeKey = "other|unclear";
    state.actionKey = "check";
    state.second = "read";
    state.stage = 0;
    state.shared = null;
    state.metrics = {};
    state.revisitSaved = false;
    $("entry").value = "";
    $("entryStatus").hidden = true;
    $("start").disabled = false;
    $("start").textContent = "开始";
    try { localStorage.removeItem("qtreeV2Text"); } catch (error) { /* ignore */ }
    if (location.hash) history.replaceState(null, "", `${location.pathname}${location.search}`);
    setScreen("entry");
    $("entry").focus();
  }

  async function startFlow() {
    const value = $("entry").value.trim();
    if (!value) {
      const card = $("entryCard");
      card.classList.remove("shake");
      void card.offsetWidth;
      card.classList.add("shake");
      $("entry").focus();
      return;
    }
    if (hasCrisis(value)) {
      $("crisis").hidden = false;
      return;
    }

    state.text = value;
    state.answers = [];
    state.questionIndex = 0;
    state.second = "read";
    state.stage = 0;
    state.shared = null;
    state.metrics = {};
    state.revisitSaved = false;
    bump("starts");
    try { localStorage.setItem("qtreeV2Text", value); } catch (error) { /* ignore */ }

    const status = $("entryStatus");
    const start = $("start");
    status.hidden = false;
    start.disabled = true;
    start.textContent = "正在整理…";

    let result;
    try {
      result = await LLM.compile(value, { timeoutMs: 75000 });
    } catch (error) {
      result = { ok: false, mode: "offline", session: Compiler.compileLocal(value), reason: "exception" };
    }

    state.session = result.session || Compiler.compileLocal(value);
    state.mode = result.mode === "model" ? "model" : "offline";
    state.reason = result.reason || "";
    status.hidden = true;
    start.disabled = false;
    start.textContent = "开始";

    if (state.mode === "offline" && state.reason && state.reason !== "no_endpoint") {
      showToast(state.reason === "model_output_not_specific" ? "模型这次不够具体，已用本地路线" : "模型没接上，先走离线路线");
    }

    renderQuestion(0);
  }

  function onBack() {
    if (state.screen === "q1") {
      setScreen("entry");
      $("entry").focus();
      return;
    }
    if (state.screen === "q2") {
      state.answers.length = 1;
      renderQuestion(0);
      return;
    }
    if (state.screen === "q3") {
      state.answers.length = 2;
      renderQuestion(1);
    }
  }

  function copyText(text, message, onSuccess) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        if (onSuccess) onSuccess();
        showToast(message);
      }).catch(() => showToast("复制失败"));
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
      if (onSuccess) onSuccess();
      showToast(message);
    } catch (error) {
      showToast("复制失败");
    }
    area.remove();
  }

  function copyCard() {
    const data = getCardData();
    const text = [
      `问题树 · ${data.meta}`,
      "",
      "三个问题",
      ...data.questions.map((question, index) => `${index + 1}. ${question}`),
      "",
      "拿去搜索",
      ...data.terms.map((term) => `- ${term}`),
      "",
      "今晚先做",
      data.action,
      "",
      "答案在知乎，这里只把问题收窄。"
    ].join("\n");
    copyText(text, "已复制");
  }

  function copyShareLink() {
    copyText(shareUrl(), "分享链接已复制", () => bump("shareLinks"));
  }

  function drawWrapped(ctx, text, x, y, maxWidth, lineHeight) {
    const chars = Array.from(String(text || ""));
    let line = "";
    for (const char of chars) {
      const test = line + char;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        line = char;
        y += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
    }
    return y;
  }

  function saveCard() {
    const data = getCardData();
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1700;
    const ctx = canvas.getContext("2d");
    if (!ctx) { showToast("当前浏览器不支持导出"); return; }

    ctx.fillStyle = "#F7F4ED";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#C8842A";
    ctx.fillRect(78, 92, 54, 3);
    ctx.fillStyle = "#1A1A1A";
    ctx.font = '600 34px "Songti SC", "Noto Serif SC", "SimSun", serif';
    ctx.fillText("问题树", 78, 155);

    ctx.fillStyle = "#6D685E";
    ctx.font = '24px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`3 个问题 · 3 个搜索词 · 1 个今晚动作 · ${data.meta}`, 78, 202);

    ctx.fillStyle = "#1A1A1A";
    ctx.font = '600 48px "Songti SC", "Noto Serif SC", "SimSun", serif';
    ctx.fillText("带走这三个问题。", 78, 310);

    let y = 405;
    data.questions.forEach((question, index) => {
      ctx.fillStyle = "#C8842A";
      ctx.font = '600 25px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(`0${index + 1}`, 78, y);
      ctx.fillStyle = "#1A1A1A";
      ctx.font = '600 40px "Songti SC", "Noto Serif SC", "SimSun", serif';
      y = drawWrapped(ctx, question, 138, y, 850, 58);
      y += 62;
    });

    y = Math.max(y + 30, 930);
    ctx.fillStyle = "#24523F";
    ctx.font = '600 22px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText("拿去搜索", 78, y);
    y += 46;
    ctx.fillStyle = "#4F4A40";
    ctx.font = '28px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    data.terms.forEach((term) => {
      ctx.fillText(`↗  ${term}`, 78, y);
      y += 42;
    });

    y = Math.max(y + 34, 1190);
    ctx.fillStyle = "#24523F";
    ctx.font = '600 22px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText("今晚先做", 78, y);
    y += 48;
    ctx.fillStyle = "#1A1A1A";
    ctx.font = '30px "Songti SC", "Noto Serif SC", "SimSun", serif';
    y = drawWrapped(ctx, data.action, 78, y, 900, 44);

    ctx.fillStyle = "#6D685E";
    ctx.font = '25px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText("答案在知乎，这里只把问题收窄。", 78, 1600);

    const url = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `问题树-${data.meta}.png`;
    link.href = url;
    link.click();
    bump("imageExports");
    showToast("图片已生成");
  }

  function restoreInput() {
    try {
      const previous = localStorage.getItem("qtreeV2Text");
      if (previous) $("entry").value = previous;
    } catch (error) { /* ignore */ }
  }

  function updateSettingsNote() {
    const mode = $("apiMode").value;
    $("settingsNote").textContent = mode === "proxy"
      ? "代理模式：Key 会随每次请求经过代理转发；代理不写入磁盘、不记录日志。适合不允许浏览器跨域的 API。"
      : "直接模式：Key 只保存在这台设备的 localStorage，不经过问题树服务器；需要 API 允许浏览器跨域。";
  }

  function openSettings() {
    const settings = LLM.getSettings();
    $("apiBase").value = settings.base;
    $("apiModel").value = settings.model;
    $("apiKey").value = settings.key;
    $("apiMode").value = settings.mode;
    updateSettingsNote();
    $("settingsModal").hidden = false;
  }

  function closeSettings() {
    $("settingsModal").hidden = true;
  }

  function saveModelSettings() {
    const value = {
      base: $("apiBase").value.trim(),
      model: $("apiModel").value.trim(),
      key: $("apiKey").value.trim(),
      mode: $("apiMode").value
    };
    if (value.key && (!value.base || !value.model)) {
      showToast("如果填 Key，API 地址和模型名也要填完整");
      return;
    }
    LLM.saveSettings(value);
    closeSettings();
    showToast("已保存到这台设备");
  }

  $("start").addEventListener("click", startFlow);
  $("entry").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      startFlow();
    }
  });
  $("example").addEventListener("click", () => {
    const sample = "我很迷茫，不知道毕业干什么";
    $("entry").value = sample;
    state.text = sample;
    startFlow();
  });
  $("back").addEventListener("click", onBack);
  $("copyBtn").addEventListener("click", copyCard);
  $("shareBtn").addEventListener("click", copyShareLink);
  $("saveBtn").addEventListener("click", saveCard);
  $("sharedCopy").addEventListener("click", copyCard);
  $("sharedSave").addEventListener("click", saveCard);
  $("sharedStart").addEventListener("click", resetToEntry);
  $("revisitDid").addEventListener("click", () => answerRevisit("acted"));
  $("revisitNot").addEventListener("click", () => answerRevisit("not"));
  $("revisitDismiss").addEventListener("click", dismissRevisit);
  $("unsaidLink").addEventListener("click", openUnsaid);
  $("unsaidClose").addEventListener("click", closeUnsaid);
  $("unsaidCancel").addEventListener("click", closeUnsaid);
  $("unsaidMode").addEventListener("change", updateUnsaidNote);
  $("unsaidSave").addEventListener("click", saveUnsaid);
  $("statsLink").addEventListener("click", openStats);
  $("statsClose").addEventListener("click", closeStats);
  $("statsReset").addEventListener("click", () => {
    writeMetrics(defaultMetrics());
    renderStats();
    showToast("本地统计已清除");
  });
  $("crisisBack").addEventListener("click", () => {
    $("crisis").hidden = true;
    resetToEntry();
  });
  $("settingsLink").addEventListener("click", openSettings);
  $("settingsClose").addEventListener("click", closeSettings);
  $("apiMode").addEventListener("change", updateSettingsNote);
  $("settingsSave").addEventListener("click", saveModelSettings);
  $("settingsClear").addEventListener("click", () => {
    LLM.clearSettings();
    $("apiBase").value = "";
    $("apiModel").value = "";
    $("apiKey").value = "";
    $("apiMode").value = "direct";
    updateSettingsNote();
    showToast("已清除这台设备的模型设置");
  });
  $("settingsModal").addEventListener("click", (event) => {
    if (event.target === $("settingsModal")) closeSettings();
  });
  $("unsaidModal").addEventListener("click", (event) => {
    if (event.target === $("unsaidModal")) closeUnsaid();
  });
  $("statsModal").addEventListener("click", (event) => {
    if (event.target === $("statsModal")) closeStats();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("settingsModal").hidden) closeSettings();
    if (!$("unsaidModal").hidden) closeUnsaid();
    if (!$("statsModal").hidden) closeStats();
  });

  restoreInput();
  if (!loadSharedFromHash()) {
    setScreen("entry");
    loadRevisit();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => { /* file:// or unsupported */ });
    });
  }
})();
