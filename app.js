(() => {
  "use strict";

  const D = window.QTREE_DATA;
  const $ = (id) => document.getElementById(id);
  const screens = {
    entry: $("screen-entry"),
    q1: $("screen-q1"),
    q2: $("screen-q2"),
    q3: $("screen-q3"),
    route: $("screen-route"),
    feedback: $("screen-feedback"),
    takeaway: $("screen-takeaway")
  };

  const state = {
    text: "",
    situation: null,
    blocker: null,
    action: null,
    second: "read",
    stage: 0,
    screen: "entry"
  };

  let toastTimer = null;

  const crisisWords = [
    "自杀", "自残", "不想活", "想死", "结束生命", "活着没意思", "死了算了", "轻生"
  ];

  function hasCrisis(text) {
    return crisisWords.some((word) => text.includes(word));
  }

  function safeText(value) {
    return String(value == null ? "" : value);
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
      takeaway: 4
    }[name];

    const dots = $("dots");
    dots.dataset.visible = name === "entry" ? "false" : "true";
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

  function getLabels() {
    const situation = D.situations.find((item) => item.id === state.situation);
    const blocker = (D.blockers[state.situation] || []).find((item) => item.id === state.blocker);
    const action = D.actions.find((item) => item.id === state.action);
    return {
      situation: situation ? situation.label : "",
      blocker: blocker ? blocker.label : "",
      action: action ? action.label : ""
    };
  }

  function renderOptions(container, items, onPick, className) {
    container.replaceChildren();
    items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className || "option";
      button.textContent = item.label;
      button.addEventListener("click", () => onPick(item));
      container.appendChild(button);
    });
  }

  function renderQ1() {
    $("q1Quote").textContent = `「${state.text}」`;
    renderOptions($("q1Options"), D.situations, (item) => {
      state.situation = item.id;
      state.blocker = null;
      renderQ2();
      setScreen("q2");
    });
  }

  function renderQ2() {
    $("q2Quote").textContent = "";
    const blockers = D.blockers[state.situation] || [];
    renderOptions($("q2Options"), blockers, (item) => {
      state.blocker = item.id;
      renderQ3();
      setScreen("q3");
    });
  }

  function renderQ3() {
    $("q3Quote").textContent = "";
    renderOptions($("q3Options"), D.actions, (item) => {
      state.action = item.id;
      state.stage = 0;
      state.second = "read";
      renderRoute();
      setScreen("route");
    });
  }

  function getSource(sourceId) {
    return D.sources[sourceId] || null;
  }

  function makeLink(label, href, className) {
    const link = document.createElement("a");
    link.textContent = label;
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (className) link.className = className;
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

    const title = makeLink(source.title, source.url, "answer-title");
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

    const read = makeLink("读这条 →", source.url, "readline");
    answer.appendChild(read);
    station.appendChild(answer);

    if (source.threadUrl && source.threadTitle) {
      const links = document.createElement("div");
      links.className = "station-links";
      links.appendChild(makeLink("看这个问题下的回答 →", source.threadUrl));
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

  function getFirstItem() {
    return D.first[`${state.situation}|${state.blocker}`] || D.first["other|unclear"];
  }

  function getSecondItem() {
    const item = D.second[state.second] || D.second.read;
    const firstSource = getFirstItem().source;
    if (item.source === firstSource) {
      const alt = (D.secondAlt && D.secondAlt[state.second] || []).find((source) => source !== firstSource);
      if (alt) return { ...item, source: alt };
    }
    return item;
  }

  function getThirdItem() {
    const item = D.third[state.action] || D.third.check;
    const used = new Set([getFirstItem().source, getSecondItem().source]);
    if (used.has(item.source)) {
      const alt = (D.thirdAlt && D.thirdAlt[state.action] || []).find((source) => !used.has(source));
      if (alt) return { ...item, source: alt };
    }
    return item;
  }

  function renderRoute() {
    const labels = getLabels();
    $("routeContext").textContent = `你走到这里：${labels.situation} · ${labels.blocker} · ${labels.action}`;
    $("routeMeta").textContent = `检索 ${D.meta.verifiedAt} · ${D.meta.sourceCount} 条可核验回答`;

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
        renderRoute();
        setScreen("route");
      });
      container.appendChild(button);
    });
  }

  function getTakeQuestions() {
    return [getFirstItem().q, getSecondItem().q, getThirdItem().q];
  }

  function renderTakeaway() {
    $("takeMeta").textContent = `3 个问题 · ${D.meta.verifiedAt}`;
    const list = $("takeList");
    list.replaceChildren();
    getTakeQuestions().forEach((question) => {
      const item = document.createElement("li");
      item.textContent = question;
      list.appendChild(item);
    });
  }

  function resetToEntry() {
    state.text = "";
    state.situation = null;
    state.blocker = null;
    state.action = null;
    state.second = "read";
    state.stage = 0;
    $("entry").value = "";
    try { localStorage.removeItem("qtreeV2Text"); } catch (error) { /* ignore */ }
    setScreen("entry");
    $("entry").focus();
  }

  function startFlow() {
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
    try { localStorage.setItem("qtreeV2Text", value); } catch (error) { /* ignore */ }
    state.situation = null;
    state.blocker = null;
    state.action = null;
    state.stage = 0;
    state.second = "read";
    renderQ1();
    setScreen("q1");
  }

  function onBack() {
    if (state.screen === "q1") {
      setScreen("entry");
      $("entry").focus();
      return;
    }
    if (state.screen === "q2") {
      renderQ1();
      setScreen("q1");
      return;
    }
    if (state.screen === "q3") {
      renderQ2();
      setScreen("q2");
    }
  }

  function copyTakeaway() {
    const text = `问题树 · ${D.meta.verifiedAt}\n\n${getTakeQuestions().map((q, index) => `${index + 1}. ${q}`).join("\n")}\n\n答案在知乎，这里只把问题收窄。`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast("已复制")).catch(() => showToast("复制失败"));
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); showToast("已复制"); }
    catch (error) { showToast("复制失败"); }
    area.remove();
  }

  function drawWrapped(ctx, text, x, y, maxWidth, lineHeight) {
    const chars = Array.from(text);
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

  function saveTakeaway() {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
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
    ctx.fillText(`3 个问题 · ${D.meta.verifiedAt}`, 78, 202);

    ctx.fillStyle = "#1A1A1A";
    ctx.font = '600 48px "Songti SC", "Noto Serif SC", "SimSun", serif';
    ctx.fillText("带走这三个问题。", 78, 310);

    let y = 405;
    getTakeQuestions().forEach((question, index) => {
      ctx.fillStyle = "#C8842A";
      ctx.font = '600 25px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(`0${index + 1}`, 78, y);
      ctx.fillStyle = "#1A1A1A";
      ctx.font = '600 40px "Songti SC", "Noto Serif SC", "SimSun", serif';
      y = drawWrapped(ctx, question, 138, y, 850, 58);
      y += 62;
    });

    ctx.fillStyle = "#6D685E";
    ctx.font = '25px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText("答案在知乎，这里只把问题收窄。", 78, 1240);

    const url = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `问题树-${D.meta.verifiedAt}.png`;
    link.href = url;
    link.click();
    showToast("图片已生成");
  }

  function restoreInput() {
    try {
      const previous = localStorage.getItem("qtreeV2Text");
      if (previous) $("entry").value = previous;
    } catch (error) { /* ignore */ }
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
  $("copyBtn").addEventListener("click", copyTakeaway);
  $("saveBtn").addEventListener("click", saveTakeaway);
  $("crisisBack").addEventListener("click", () => {
    $("crisis").hidden = true;
    resetToEntry();
  });

  restoreInput();
  renderQ1();
  setScreen("entry");

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => { /* file:// or unsupported */ });
    });
  }
})();
