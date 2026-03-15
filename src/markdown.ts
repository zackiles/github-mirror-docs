export function toConfluenceStorage(markdown: string, sourceUrl: string, banner: boolean): string {
  let result = banner ? confluenceBanner(sourceUrl) + "\n" : ""
  result += convertToStorage(markdown, sourceUrl)
  return result
}

export function toLinearMarkdown(markdown: string, sourceUrl: string, banner: boolean): string {
  let result = banner ? linearBanner(sourceUrl) + "\n\n" : ""
  result += rewriteLinks(markdown, sourceUrl)
  return result
}

export function toNotionMarkdown(markdown: string, sourceUrl: string, banner: boolean): string {
  let result = banner ? notionBanner(sourceUrl) + "\n\n" : ""
  result += rewriteLinks(markdown, sourceUrl)
  return result
}

export function toWikiMarkdown(markdown: string, sourceUrl: string, banner: boolean): string {
  let result = banner ? wikiBanner(sourceUrl) + "\n\n" : ""
  result += rewriteLinks(markdown, sourceUrl)
  return result
}

export function toHtml(markdown: string, sourceUrl: string, banner: boolean): string {
  let result = banner ? htmlBanner(sourceUrl) + "\n" : ""
  result += convertToHtml(markdown, sourceUrl)
  return result
}

function confluenceBanner(sourceUrl: string): string {
  const editUrl = sourceUrl.replace("/blob/", "/edit/")
  return [
    '<ac:structured-macro ac:name="info">',
    '  <ac:parameter ac:name="title">Mirrored from GitHub</ac:parameter>',
    "  <ac:rich-text-body>",
    `    <p>This page is automatically published from <a href="${sourceUrl}">${
      pathFromUrl(sourceUrl)
    }</a>. `,
    `Edits made here will be overwritten on next sync. `,
    `<a href="${editUrl}">Edit on GitHub \u2192</a></p>`,
    "  </ac:rich-text-body>",
    "</ac:structured-macro>",
  ].join("\n")
}

function linearBanner(sourceUrl: string): string {
  const editUrl = sourceUrl.replace("/blob/", "/edit/")
  const path = pathFromUrl(sourceUrl)
  return [
    `> **Mirrored from GitHub** \u2014 This document is published from`,
    `> [${path}](${sourceUrl}).`,
    `> Edits here will be overwritten on next sync.`,
    `> [Edit on GitHub \u2192](${editUrl})`,
    "",
    "---",
  ].join("\n")
}

function notionBanner(sourceUrl: string): string {
  const editUrl = sourceUrl.replace("/blob/", "/edit/")
  const path = pathFromUrl(sourceUrl)
  return [
    `> **Mirrored from GitHub** \u2014 This page is published from`,
    `> [${path}](${sourceUrl}).`,
    `> Edits here will be overwritten on next sync.`,
    `> [Edit on GitHub \u2192](${editUrl})`,
    "",
    "---",
  ].join("\n")
}

function wikiBanner(sourceUrl: string): string {
  const editUrl = sourceUrl.replace("/blob/", "/edit/")
  const path = pathFromUrl(sourceUrl)
  return [
    `> **Mirrored from GitHub** \u2014 This wiki page is published from`,
    `> [${path}](${sourceUrl}).`,
    `> Edits here will be overwritten on next sync.`,
    `> [Edit on GitHub \u2192](${editUrl})`,
    "",
    "---",
  ].join("\n")
}

function htmlBanner(sourceUrl: string): string {
  const editUrl = sourceUrl.replace("/blob/", "/edit/")
  const path = pathFromUrl(sourceUrl)
  return [
    '<div style="background:#e8f4fd;border:1px solid #b8daff;border-radius:4px;padding:12px;margin-bottom:16px">',
    `  <strong>Mirrored from GitHub</strong> \u2014 This page is published from`,
    `  <a href="${sourceUrl}">${path}</a>.`,
    `  Edits here will be overwritten on next sync.`,
    `  <a href="${editUrl}">Edit on GitHub \u2192</a>`,
    "</div>",
  ].join("\n")
}

function pathFromUrl(url: string): string {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/blob\/[^/]+\/(.+)/)
  if (match) return `${match[1]}/${match[2]}`
  return url
}

function convertToStorage(markdown: string, baseUrl: string): string {
  const lines = rewriteLinks(markdown, baseUrl).split("\n")
  const output: string[] = []
  let inCodeBlock = false
  let codeLang = ""
  let codeLines: string[] = []
  let inList = false
  let listType: "ul" | "ol" = "ul"
  let tableRows: string[][] = []
  let inTable = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeLang = line.slice(3).trim()
        codeLines = []
      } else {
        output.push(codeBlockMacro(codeLines.join("\n"), codeLang))
        inCodeBlock = false
        codeLang = ""
        codeLines = []
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    if (line.startsWith("|") && line.endsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim())
      if (cells.every((c) => /^[-:]+$/.test(c))) continue
      if (!inTable) inTable = true
      tableRows.push(cells)
      const nextLine = lines[i + 1]
      const tableEnds = !nextLine || !nextLine.startsWith("|")
      if (tableEnds) {
        output.push(renderTable(tableRows))
        tableRows = []
        inTable = false
      }
      continue
    }

    if (/^#{1,6}\s/.test(line)) {
      if (inList) {
        output.push(inList ? `</${listType}>` : "")
        inList = false
      }
      const level = line.match(/^(#+)/)?.[1].length ?? 1
      const text = line.replace(/^#+\s*/, "")
      output.push(`<h${level}>${inlineFormat(text)}</h${level}>`)
      continue
    }

    if (/^[-*]\s/.test(line)) {
      if (!inList) {
        listType = "ul"
        output.push("<ul>")
        inList = true
      }
      output.push(`<li>${inlineFormat(line.replace(/^[-*]\s+/, ""))}</li>`)
      continue
    }

    if (/^\d+\.\s/.test(line)) {
      if (!inList) {
        listType = "ol"
        output.push("<ol>")
        inList = true
      }
      output.push(`<li>${inlineFormat(line.replace(/^\d+\.\s+/, ""))}</li>`)
      continue
    }

    if (inList) {
      output.push(`</${listType}>`)
      inList = false
    }

    if (line.startsWith("---") && line.match(/^-{3,}$/)) {
      output.push("<hr />")
      continue
    }

    if (line.startsWith("> ")) {
      output.push(
        `<ac:structured-macro ac:name="quote"><ac:rich-text-body><p>${
          inlineFormat(line.slice(2))
        }</p></ac:rich-text-body></ac:structured-macro>`,
      )
      continue
    }

    if (line.trim() === "") {
      continue
    }

    output.push(`<p>${inlineFormat(line)}</p>`)
  }

  if (inList) output.push(`</${listType}>`)

  return output.join("\n")
}

function codeBlockMacro(code: string, lang: string): string {
  const langAttr = lang ? `<ac:parameter ac:name="language">${escapeXml(lang)}</ac:parameter>` : ""
  return [
    '<ac:structured-macro ac:name="code">',
    langAttr,
    "<ac:plain-text-body><![CDATA[",
    code,
    "]]></ac:plain-text-body>",
    "</ac:structured-macro>",
  ]
    .filter(Boolean)
    .join("\n")
}

function renderTable(rows: string[][]): string {
  if (rows.length === 0) return ""
  const [header, ...body] = rows
  const headerCells = header.map((c) => `<th><p>${inlineFormat(c)}</p></th>`).join("")
  const bodyRows = body
    .map((row) => {
      const cells = row.map((c) => `<td><p>${inlineFormat(c)}</p></td>`).join("")
      return `<tr>${cells}</tr>`
    })
    .join("\n")
  return `<table><thead><tr>${headerCells}</tr></thead><tbody>\n${bodyRows}\n</tbody></table>`
}

function inlineFormat(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<ac:image><ri:url ri:value="$2" /></ac:image>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function rewriteLinks(markdown: string, baseUrl: string): string {
  const repoBase = baseUrl.replace(/\/blob\/[^/]+\/.+$/, "")
  const branch = baseUrl.match(/\/blob\/([^/]+)\//)?.[1] ?? "main"

  return markdown.replace(
    /(!?\[([^\]]*)\])\(([^)]+)\)/g,
    (_match, prefix: string, _text: string, href: string) => {
      if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("#")) {
        return `${prefix}(${href})`
      }
      const absolute = `${repoBase}/blob/${branch}/${href.replace(/^\.\//, "")}`
      return `${prefix}(${absolute})`
    },
  )
}

function convertToHtml(markdown: string, baseUrl: string): string {
  const lines = rewriteLinks(markdown, baseUrl).split("\n")
  const output: string[] = []
  let inCodeBlock = false
  let codeLines: string[] = []
  let codeLang = ""

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeLang = line.slice(3).trim()
        codeLines = []
      } else {
        const cls = codeLang ? ` class="language-${escapeXml(codeLang)}"` : ""
        output.push(`<pre><code${cls}>${escapeXml(codeLines.join("\n"))}</code></pre>`)
        inCodeBlock = false
      }
      continue
    }
    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }
    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^(#+)/)?.[1].length ?? 1
      const text = line.replace(/^#+\s*/, "")
      output.push(`<h${level}>${htmlInline(text)}</h${level}>`)
      continue
    }
    if (line.startsWith("---") && line.match(/^-{3,}$/)) {
      output.push("<hr>")
      continue
    }
    if (line.startsWith("> ")) {
      output.push(`<blockquote><p>${htmlInline(line.slice(2))}</p></blockquote>`)
      continue
    }
    if (line.trim() === "") continue
    output.push(`<p>${htmlInline(line)}</p>`)
  }
  return output.join("\n")
}

function htmlInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
}
