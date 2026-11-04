(function () {
  "use strict";

  var panel = document.getElementById("skillSearchDialog");
  var input = document.getElementById("skillSearchInput");
  var resultsRoot = document.getElementById("skillSearchResults");
  var status = document.getElementById("skillSearchStatus");
  var scrim = document.getElementById("skillSearchScrim");
  var closeButton = document.getElementById("skillSearchClose");
  var suggestions = document.getElementById("skillSearchSuggestions");
  var buttons = [].slice.call(document.querySelectorAll("[data-open-skill-search]"));
  if (!panel || !input || !resultsRoot || !scrim || !buttons.length) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var records = [], found = [], active = 0;
  var debounceId = 0, spotlightId = 0, priorFocus = null, markedTarget = null;
  var bridge = window.portfolioSkillSearch || null;

  var aliases = {
    "reactjs": "react", "react js": "react",
    "node": "nodejs", "node js": "nodejs",
    "ts": "typescript", "js": "javascript",
    "postgres": "postgresql", "ci cd": "cicd", "cicd": "cicd",
    "model context protocol": "mcp", "genai": "ai",
    "d3": "d3js", "d3 js": "d3js", "aws lambda": "lambda"
  };

  function normalize(value) {
    return String(value || "").normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\bnode js\b/g, "nodejs")
      .replace(/\bd3 js\b/g, "d3js")
      .replace(/\bci cd\b/g, "cicd")
      .replace(/\s+/g, " ").trim();
  }
  function canonical(value) {
    var normalized = normalize(value);
    return aliases[normalized] || normalized;
  }
  function containsTerm(haystack, needle) {
    if (!needle) return false;
    return (" " + haystack + " ").indexOf(" " + needle + " ") >= 0 ||
      (needle.length >= 3 && (" " + haystack).indexOf(" " + needle) >= 0);
  }
  function makeRecord(type, title, excerpt, target, keywords, weight, nodeId) {
    var full = [title, excerpt, keywords || ""].join(" ");
    records.push({
      type: type, title: title, excerpt: excerpt, target: target,
      nodeId: nodeId || null, weight: weight || 0,
      titleIndex: normalize(title), textIndex: normalize(full),
      tagsIndex: normalize(keywords || "")
    });
  }
  function addCards(selector, type, weight, titleSelector, contextSelector) {
    [].forEach.call(document.querySelectorAll(selector), function (card) {
      var heading = card.querySelector(titleSelector);
      var context = contextSelector ? card.querySelector(contextSelector) : null;
      var title = heading ? heading.textContent.trim() : "";
      if (!title) return;
      var copy = card.querySelector("p");
      var summary = copy ? copy.textContent.trim() : card.textContent.trim();
      var prefix = context ? context.textContent.trim() + " \u00b7 " : "";
      makeRecord(type, prefix + title, summary, card, card.textContent.trim(), weight);
    });
  }
  function buildIndex() {
    records = [];
    // Search only the demonstrated work and technologies on this page.
    addCards("#roleWall .role-card", "Career proof", 15, ".role-body h3", ".role-side strong");
    addCards("#experienceGrid .experience-card", "Shipped work", 24, "h3", ".source");
    addCards("#portalGrid .portal-card", "Public project", 17, ".portal-top h3", ".portal-kicker");
    addCards("#case-studies .case-study", "Engineering case study", 40, ".case-study-title", ".case-study-meta");
    addCards("#ai .ai-card", "Engineering approach", 8, "h3", null);
    if (bridge && Array.isArray(bridge.skills)) {
      bridge.skills.forEach(function (skill) {
        makeRecord("Skill map", skill.label, skill.note,
          document.getElementById("skillDetail"), (skill.tags || []).join(" "), 12, skill.id);
      });
    }
    [
      ["#top .hero-copy", "The short version"],
      ["#command .command-left", "Engineering profile"],
      ["#flow .story-flow-copy", "How I work"],
      ["#proof .section-head", "Professional experience"],
      ["#portals .section-head", "Live products"],
      ["#ai .ai-copy", "AI engineering"],
      ["#map .section-head", "Interactive skill map"],
      ["#experience .section-head", "Delivery history"],
      ["#contact .contact-panel", "Let's talk"]
    ].forEach(function (pair) {
      var element = document.querySelector(pair[0]);
      if (!element) return;
      var heading = element.querySelector("h1,h2");
      var summary = element.textContent.trim().replace(/\s+/g, " ");
      makeRecord("On this page", heading ? heading.textContent.trim() : pair[1],
        summary, element, "", -12);
    });
  }
  function score(record, terms, phrase) {
    if (!terms.every(function (term) { return containsTerm(record.textIndex, term); })) return -1;
    var rank = record.weight;
    if (record.titleIndex === phrase) rank += 170;
    else if (containsTerm(record.titleIndex, phrase)) rank += 90;
    else if (terms.every(function (term) { return containsTerm(record.titleIndex, term); })) rank += 60;
    if (containsTerm(record.tagsIndex, phrase)) rank += 55;
    if (containsTerm(record.textIndex, phrase)) rank += 26;
    return rank + Math.min(terms.length, 4) * 4;
  }
  function find(query) {
    var phrase = canonical(query);
    if (!phrase) return [];
    var terms = phrase.split(" ").filter(Boolean);
    return records.map(function (record, index) {
      return { record: record, points: score(record, terms, phrase), index: index };
    }).filter(function (hit) {
      return hit.points >= 0;
    }).sort(function (a, b) {
      return b.points - a.points || a.index - b.index;
    }).map(function (item) { return item.record; });
  }
  function excerptFor(record, query) {
    var source = record.excerpt.replace(/\s+/g, " ").trim();
    if (source.length <= 165) return source;
    var match = canonical(query).split(" ")[0];
    var at = normalize(source).indexOf(match);
    var start = at > 90 && at < source.length ? Math.max(0, at - 52) : 0;
    return (start > 0 ? "..." : "") + source.slice(start, start + 165).trim() +
      (start + 165 < source.length ? "..." : "");
  }
  function setActive(index) {
    var options = [].slice.call(resultsRoot.querySelectorAll(".skill-search-result"));
    if (!options.length) return;
    active = (index + options.length) % options.length;
    options.forEach(function (option, i) {
      var selected = i === active;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-selected", selected ? "true" : "false");
    });
    input.setAttribute("aria-activedescendant", options[active].id);
    options[active].scrollIntoView({ block: "nearest", behavior: "auto" });
  }
  function render(query) {
    var term = query.trim();
    resultsRoot.replaceChildren();
    input.removeAttribute("aria-activedescendant");
    suggestions.hidden = Boolean(term);
    if (!term) {
      status.textContent = "Search for a technology, project, platform, or engineering practice.";
      found = [];
      return;
    }
    found = find(term);
    status.textContent = found.length
      ? found.length + " evidence match" + (found.length === 1 ? "" : "es") +
        ". Choose one to jump to the work."
      : "No verified match on this page. Ask Alex about your exact stack.";
    if (!found.length) {
      var empty = document.createElement("div");
      empty.className = "skill-search-empty";
      var title = document.createElement("strong");
      title.textContent = "No proof found for \u201c" + term + "\u201d";
      var body = document.createElement("p");
      body.textContent = "That does not establish whether I can do it. Send the requirement and I'll tell you where I have relevant experience.";
      var mail = document.createElement("a");
      mail.href = "mailto:alex@alext.io?subject=Question%20about%20my%20engineering%20experience";
      mail.textContent = "Ask me about this skill \u2197";
      mail.className = "skill-search-contact";
      empty.append(title, body, mail);
      resultsRoot.appendChild(empty);
      return;
    }
    found.slice(0, 8).forEach(function (record, index) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "skill-search-result" + (index === 0 ? " is-selected" : "");
      button.id = "skillSearchOption-" + index;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", index === 0 ? "true" : "false");
      button.style.setProperty("--item-index", String(index));
      var copy = document.createElement("span");
      copy.className = "skill-search-result-copy";
      var category = document.createElement("span");
      category.className = "skill-search-type";
      category.textContent = record.type;
      var title = document.createElement("strong");
      title.textContent = record.title;
      var detail = document.createElement("small");
      detail.textContent = excerptFor(record, term);
      var icon = document.createElement("span");
      icon.className = "skill-search-arrow";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "\u2197";
      copy.append(category, title, detail);
      button.append(copy, icon);
      button.addEventListener("click", function () { reveal(record, term); });
      button.addEventListener("pointerenter", function () { setActive(index); });
      resultsRoot.appendChild(button);
    });
    active = 0;
    input.setAttribute("aria-activedescendant", "skillSearchOption-0");
  }
  function clearMarks() {
    if (markedTarget) {
      [].forEach.call(markedTarget.querySelectorAll("mark.recruiter-keyword"), function (mark) {
        mark.replaceWith(document.createTextNode(mark.textContent));
      });
      markedTarget.normalize();
      markedTarget.classList.remove("recruiter-spotlight");
    }
    markedTarget = null;
    window.clearTimeout(spotlightId);
  }
  function highlightTerms(element, query) {
    var rawTerms = String(query).trim().split(/\s+/).filter(function (term) {
      return term.length >= 2;
    }).slice(0, 4);
    if (!rawTerms.length || !window.NodeFilter) return;
    var expression = rawTerms.map(function (term) {
      return term.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
    }).join("|");
    var regex = new RegExp("(" + expression + ")", "gi");
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.parentElement || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement.closest("a,button,script,style,mark,textarea")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], count = 0, node;
    while ((node = walker.nextNode()) && nodes.length < 60) nodes.push(node);
    nodes.forEach(function (textNode) {
      if (count >= 12) return;
      var source = textNode.textContent;
      regex.lastIndex = 0;
      if (!regex.test(source)) return;
      regex.lastIndex = 0;
      var fragment = document.createDocumentFragment(), last = 0, match;
      while ((match = regex.exec(source)) && count < 12) {
        if (match.index > last) fragment.appendChild(document.createTextNode(source.slice(last, match.index)));
        var mark = document.createElement("mark");
        mark.className = "recruiter-keyword";
        mark.textContent = match[0];
        fragment.appendChild(mark);
        count++;
        last = regex.lastIndex;
      }
      fragment.appendChild(document.createTextNode(source.slice(last)));
      textNode.parentNode.replaceChild(fragment, textNode);
    });
  }
  function reveal(record, query) {
    close(false);
    clearMarks();
    var target = record.target;
    if (record.nodeId && bridge && typeof bridge.selectSkill === "function") {
      bridge.selectSkill(record.nodeId);
      target = document.getElementById("skillDetail");
    }
    if (!target) return;
    target.classList.remove("recruiter-spotlight");
    void target.offsetWidth;
    target.classList.add("recruiter-spotlight");
    markedTarget = target;
    highlightTerms(target, query);
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "center" });
    window.setTimeout(function () { target.focus({ preventScroll: true }); },
      reduceMotion.matches ? 0 : 380);
    spotlightId = window.setTimeout(clearMarks, 9000);
  }
  function close(restoreFocus) {
    if (panel.hidden) return;
    panel.hidden = true; scrim.hidden = true;
    document.body.classList.remove("skill-search-is-open");
    buttons.forEach(function (button) { button.setAttribute("aria-expanded", "false"); });
    if (restoreFocus && priorFocus && typeof priorFocus.focus === "function") priorFocus.focus({ preventScroll: true });
  }
  function open(source) {
    if (!panel.hidden) return;
    priorFocus = source || document.activeElement;
    var mobileMenu = document.getElementById("mobileMenu");
    var menuButton = document.getElementById("menuButton");
    if (mobileMenu) mobileMenu.classList.remove("is-open");
    if (menuButton) {
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-label", "Open menu");
    }
    panel.hidden = false; scrim.hidden = false;
    document.body.classList.add("skill-search-is-open");
    buttons.forEach(function (button) { button.setAttribute("aria-expanded", "true"); });
    input.value = ""; render("");
    window.requestAnimationFrame(function () { input.focus(); });
  }
  buttons.forEach(function (button) {
    button.addEventListener("click", function () { open(button); });
  });
  closeButton.addEventListener("click", function () { close(true); });
  scrim.addEventListener("click", function () { close(true); });
  input.addEventListener("input", function () {
    window.clearTimeout(debounceId);
    debounceId = window.setTimeout(function () { render(input.value); }, 65);
  });
  input.addEventListener("keydown", function (event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (found.length) {
        event.preventDefault();
        setActive(active + (event.key === "ArrowDown" ? 1 : -1));
      }
    } else if (event.key === "Enter" && found.length) {
      event.preventDefault();
      reveal(found[active], input.value);
    }
  });
  suggestions.addEventListener("click", function (event) {
    var chip = event.target.closest("[data-skill-suggestion]");
    if (!chip) return;
    input.value = chip.getAttribute("data-skill-suggestion") || "";
    render(input.value); input.focus();
  });
  panel.addEventListener("keydown", function (event) {
    if (event.key !== "Tab") return;
    var focusable = [].slice.call(panel.querySelectorAll(
      "button:not([disabled]),input:not([disabled]),a[href]"
    )).filter(function (el) { return el.getClientRects().length > 0; });
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !panel.hidden) {
      event.preventDefault(); close(true); return;
    }
    var node = event.target;
    var typing = node && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName));
    if ((event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) ||
        (event.key === "/" && !typing && !event.altKey && !event.ctrlKey && !event.metaKey)) {
      event.preventDefault();
      if (panel.hidden) open(document.activeElement);
      else close(true);
    }
  });
  panel.addEventListener("pointermove", function (event) {
    if (reduceMotion.matches || event.pointerType === "touch") return;
    var bounds = panel.getBoundingClientRect();
    panel.style.setProperty("--liquid-x", ((event.clientX - bounds.left) / bounds.width * 100).toFixed(1) + "%");
    panel.style.setProperty("--liquid-y", ((event.clientY - bounds.top) / bounds.height * 100).toFixed(1) + "%");
  }, { passive: true });
  buildIndex();
})();
