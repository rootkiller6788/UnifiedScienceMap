import { init } from "./main";

class MapOfScience extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });

    // Create elements
    const wrapper = document.createElement("div");
    wrapper.setAttribute("id", "chart");

    const chartD3 = document.createElement("div");
    chartD3.setAttribute("id", "chart-d3");

    const foreground = document.createElement("div");
    foreground.setAttribute("id", "foreground");

    const article = document.createElement("div");
    article.setAttribute("id", "article");
    article.classList.add("content");

    const articleContent = document.createElement("div");
    articleContent.setAttribute("id", "article-content");

    // Build DOM structure
    article.appendChild(articleContent);
    wrapper.appendChild(chartD3);
    wrapper.appendChild(foreground);
    wrapper.appendChild(article);

    // Attach to shadow DOM
    shadow.appendChild(wrapper);
  }

  connectedCallback() {
    console.log("Custom element added to page.");
    init();
  }

  disconnectedCallback() {
    console.log("Custom element removed from page.");
  }
}

customElements.define("map-of-science", MapOfScience);
