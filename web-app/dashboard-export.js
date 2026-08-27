/**
 * Fill Telecalling Lead Audit template via JSZip (preserves slicers/charts/formulas).
 * Writes Raw Data only — Executive / Performance / Detailed / ChartCache stay formula-driven.
 *
 * Excel Online: opens after calcChain dangling-refs are stripped. Slicers + FILTER/UNIQUE
 * ChartCache sync are desktop Excel 365 features; Online may show static charts / limited slicers.
 */

const TEMPLATE_URL = new URL("./templates/telecalling-lead-audit.xlsx", import.meta.url).href;

/** cellXfs from template styles.xml: 1=@ text, 2=date, 3=datetime, 4=int, 9=0.00% */
const STYLE = {text: 1, date: 2, datetime: 3, int: 4, pct: 9};

function requireJSZip(){
  const JZ = window.JSZip;
  if(typeof JZ !== "function") throw new Error("JSZip failed to load. Check your network connection and reload.");
  return JZ;
}

function xmlEscape(text){
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colLetter(n){
  let s = "";
  while(n > 0){
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function clean(value){
  const n = String(value ?? "").trim().toLowerCase();
  if(["", "nan", "none", "nat", "undefined", "null"].includes(n)) return "";
  return String(value).trim();
}

function parseLooseDate(value){
  if(value instanceof Date && !Number.isNaN(value.valueOf())) return new Date(value.getTime());
  if(typeof value === "number" && Number.isFinite(value)){
    const utc = Date.UTC(1899, 11, 30) + Math.round(value * 86400000);
    return new Date(utc);
  }
  const s = clean(value); if(!s) return null;
  const iso = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(iso){
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] || 0), Number(iso[5] || 0), Number(iso[6] || 0));
    return Number.isNaN(d.valueOf()) ? null : d;
  }
  const match = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(match){
    const day = Number(match[1]), month = Number(match[2]), year = match[3].length === 2 ? Number(`20${match[3]}`) : Number(match[3]);
    if(month >= 1 && month <= 12 && day >= 1 && day <= 31){
      const d = new Date(year, month - 1, day, Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
      if(!Number.isNaN(d.valueOf()) && d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d;
    }
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

/** Date-only Excel serial (no time fraction) for registration / slicer. */
function toExcelDateSerial(date){
  if(!(date instanceof Date) || Number.isNaN(date.valueOf())) return null;
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return (utc - Date.UTC(1899, 11, 30)) / 86400000;
}

/** Full datetime Excel serial for next-followup. */
function toExcelDateTimeSerial(date){
  if(!(date instanceof Date) || Number.isNaN(date.valueOf())) return null;
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds());
  return (utc - Date.UTC(1899, 11, 30)) / 86400000;
}

function startOfLocalDay(d){
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function mapSeverity(errorSeverity, errorLabels, highSeverityErrors){
  const sev = String(errorSeverity || "").toUpperCase();
  if(sev === "HIGH") return "Critical";
  if(sev === "MEDIUM") return "Medium";
  if(sev === "NONE" || !errorLabels.length) return "";
  const high = highSeverityErrors instanceof Set ? highSeverityErrors : new Set(highSeverityErrors || []);
  return errorLabels.some(label => high.has(label)) ? "Critical" : "Medium";
}

function splitErrorLabels(errorTypes){
  const raw = clean(errorTypes);
  if(!raw || /^none$/i.test(raw)) return [];
  return raw.split(/\s*\|\s*|\s*,\s*/).map(s => s.trim()).filter(Boolean).filter(s => !/^none$/i.test(s) && !/tat/i.test(s));
}

function leadKey(row){
  return `${String(row?.mobile ?? "").trim().toLowerCase()}\u0001${String(row?.project ?? "").trim().toLowerCase()}`;
}

/** Map LeadLens audit result rows → RawData row objects. */
export function mapResultsToRawDataRows(results, {highSeverityErrors} = {}){
  const today = startOfLocalDay(new Date());
  return (results || []).map(row => {
    const labels = splitErrorLabels(row.errorTypes);
    const errorFlag = labels.length ? 1 : 0;
    const severity = mapSeverity(row.errorSeverity, labels, highSeverityErrors);
    const reg = parseLooseDate(row.registration);
    const next = parseLooseDate(row.next);
    const regDay = reg ? startOfLocalDay(reg) : null;
    let overdue = "";
    if(row.overdue !== undefined && row.overdue !== null && row.overdue !== ""){
      const n = Number(row.overdue);
      if(Number.isFinite(n)) overdue = Math.round(n);
    }else if(next){
      overdue = Math.round((today - startOfLocalDay(next)) / 86400000);
    }
    return {
      project: clean(row.project),
      mobile: clean(row.mobile),
      telecaller: clean(row.telecaller) || "Unknown",
      registration: regDay,
      registrationSerial: regDay ? toExcelDateSerial(regDay) : null,
      status: clean(row.status),
      comments: clean(row.comments),
      next,
      nextSerial: next ? toExcelDateTimeSerial(next) : null,
      location: clean(row.location),
      overdue,
      parameter: clean(row.parameter),
      connected: clean(row.connected),
      requirement: clean(row.requirement),
      source: clean(row.source),
      sourceName: clean(row.sourceName),
      commentQuality: Number.isFinite(Number(row.commentQuality)) ? Number(row.commentQuality) : 0,
      buyingIntent: clean(row.buyingIntent),
      budget: clean(row.budget),
      errorType: labels.length ? labels.join(" | ") : "None",
      errorLabels: labels,
      errorDetails: clean(row.observation),
      recommendedAction: clean(row.recommendation),
      severity,
      auditStatus: errorFlag ? "Error" : "Clean",
      errorFlag
    };
  });
}

function inlineStr(ref, text, style){
  const s = style != null ? ` s="${style}"` : "";
  return `<c r="${ref}"${s} t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>`;
}

function numberCell(ref, num, style){
  if(num === null || num === undefined || num === "") return "";
  const s = style != null ? ` s="${style}"` : "";
  return `<c r="${ref}"${s}><v>${num}</v></c>`;
}

/** Consecutive same Mobile + Project → merge A and B (same pattern as audit Excel). */
function buildMergeCellsXml(rawRows){
  const merges = [];
  let start = 0;
  for(let i = 1; i <= rawRows.length; i++){
    const same = i < rawRows.length && leadKey(rawRows[i]) === leadKey(rawRows[start]);
    if(same) continue;
    if(i - start > 1){
      const r0 = start + 2; // sheet row (header is 1)
      const r1 = i + 1;
      merges.push(`A${r0}:A${r1}`, `B${r0}:B${r1}`);
    }
    start = i;
  }
  if(!merges.length) return "";
  return `<mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`;
}

function buildRawDataRowsXml(rawRows){
  const parts = [];
  for(let i = 0; i < rawRows.length; i++){
    const r = i + 2;
    const row = rawRows[i];
    const cells = [];
    cells.push(inlineStr(`A${r}`, row.project));
    cells.push(inlineStr(`B${r}`, row.mobile, STYLE.text));
    cells.push(inlineStr(`C${r}`, row.telecaller));
    if(row.registrationSerial != null) cells.push(numberCell(`D${r}`, row.registrationSerial, STYLE.date));
    cells.push(inlineStr(`E${r}`, row.status));
    cells.push(inlineStr(`F${r}`, row.comments));
    if(row.nextSerial != null) cells.push(numberCell(`G${r}`, row.nextSerial, STYLE.datetime));
    cells.push(inlineStr(`H${r}`, row.location));
    if(row.overdue !== "") cells.push(numberCell(`I${r}`, row.overdue, STYLE.int));
    cells.push(inlineStr(`J${r}`, row.parameter));
    cells.push(inlineStr(`K${r}`, row.connected));
    cells.push(inlineStr(`L${r}`, row.requirement));
    cells.push(inlineStr(`M${r}`, row.source || ""));
    cells.push(inlineStr(`N${r}`, row.sourceName || ""));
    cells.push(numberCell(`O${r}`, 1, STYLE.int));
    cells.push(inlineStr(`P${r}`, row.errorType));
    cells.push(inlineStr(`Q${r}`, row.errorDetails));
    cells.push(inlineStr(`R${r}`, row.recommendedAction));
    cells.push(inlineStr(`S${r}`, row.severity));
    cells.push(inlineStr(`T${r}`, row.auditStatus));
    cells.push(numberCell(`U${r}`, row.errorFlag, STYLE.int));
    // Hidden RowVis — SUBTOTAL so Graphical slicers drive ChartCache formulas
    cells.push(`<c r="V${r}"><f>SUBTOTAL(103,B${r})</f><v>1</v></c>`);
    parts.push(`<row r="${r}" spans="1:22">${cells.join("")}</row>`);
  }
  return parts.join("");
}

function replaceSheetDataPreserveHeader(sheetXml, dataRowsXml, dimensionRef, mergeXml){
  let out = sheetXml.replace(/<dimension[^/]*\/>/i, `<dimension ref="${dimensionRef}"/>`);
  // Keep row r="1", replace everything after it inside sheetData
  out = out.replace(
    /(<sheetData[^>]*>)([\s\S]*?)(<\/sheetData>)/i,
    (_, open, inner, close) => {
      const headerMatch = inner.match(/<row[^>]*\br="1"[^>]*>[\s\S]*?<\/row>/i);
      const header = headerMatch ? headerMatch[0] : "";
      return `${open}${header}${dataRowsXml}${close}`;
    }
  );
  out = out.replace(/<mergeCells[\s\S]*?<\/mergeCells>/i, "");
  if(mergeXml){
    if(/<pageMargins\b/i.test(out)) out = out.replace(/<pageMargins\b/i, `${mergeXml}<pageMargins`);
    else if(/<tableParts\b/i.test(out)) out = out.replace(/<tableParts\b/i, `${mergeXml}<tableParts`);
    else out = out.replace(/<\/worksheet>/i, `${mergeXml}</worksheet>`);
  }
  return out;
}

function stripNonRowVisCalculatedFormulas(tableXml){
  // Remove calculated formulas except RowVis (needed for slicer-aware charts)
  return tableXml.replace(
    /<tableColumn\b([^>]*name="([^"]+)"[^>]*)>([\s\S]*?)<\/tableColumn>/g,
    (full, attrs, name, body) => {
      if(name === "RowVis") return full;
      const cleaned = body.replace(/<calculatedColumnFormula[\s\S]*?<\/calculatedColumnFormula>/g, "");
      if(/^\s*$/.test(cleaned) && !/>\s*$/.test(attrs)){
        // self-close style not used; keep empty body
      }
      return `<tableColumn${attrs}>${cleaned}</tableColumn>`;
    }
  );
}

function setTableRef(tableXml, ref){
  return tableXml
    .replace(/\bref="[^"]*"/, `ref="${ref}"`)
    .replace(/<autoFilter\b([^>]*)\bref="[^"]*"/, `<autoFilter$1ref="${ref}"`);
}

async function readZipText(zip, name){
  const f = zip.file(name);
  if(!f) return null;
  return f.async("string");
}

/** Remove calcChain part + package references (dangling Override/Relationship breaks Excel Online). */
function stripCalcChainPackageRefs(zip, contentTypesXml, workbookRelsXml){
  if(zip.file("xl/calcChain.xml")) zip.remove("xl/calcChain.xml");
  let ct = contentTypesXml || "";
  ct = ct.replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>\s*/gi, "");
  let rels = workbookRelsXml || "";
  rels = rels.replace(/<Relationship\b[^>]*Target="calcChain\.xml"[^>]*\/>\s*/gi, "");
  // Also match namespaced Relationship tags rewritten by some zip tools
  rels = rels.replace(/<[^:>\s]*:?Relationship\b[^>]*Target="calcChain\.xml"[^>]*\/>\s*/gi, "");
  return {contentTypesXml: ct, workbookRelsXml: rels};
}

async function loadTemplateBytes(templateUrl = TEMPLATE_URL){
  const res = await fetch(templateUrl, {cache: "no-store"});
  if(!res.ok) throw new Error(`Could not load dashboard template (${res.status}).`);
  return res.arrayBuffer();
}

/**
 * Build a finished dashboard workbook blob from audit result rows.
 * @param {object[]} results LeadLens result rows
 * @param {{highSeverityErrors?: Set<string>|string[], templateUrl?: string}} [options]
 */
export async function buildTelecallerDashboardBlob(results, options = {}){
  const JSZip = requireJSZip();
  const rawRows = mapResultsToRawDataRows(results, {highSeverityErrors: options.highSeverityErrors});
  if(!rawRows.length) throw new Error("No audited rows to put in the dashboard.");

  const lastDataRow = 1 + rawRows.length;
  const dataXml = buildRawDataRowsXml(rawRows);
  // Do NOT merge cells inside RawData — Excel Tables forbid merges; Online treats that as corrupt.
  const dimension = `A1:V${Math.max(lastDataRow, 2)}`;

  const bytes = await loadTemplateBytes(options.templateUrl || TEMPLATE_URL);
  const zip = await JSZip.loadAsync(bytes);

  let sheet2 = await readZipText(zip, "xl/worksheets/sheet2.xml");
  sheet2 = replaceSheetDataPreserveHeader(sheet2, dataXml, dimension, "");
  zip.file("xl/worksheets/sheet2.xml", sheet2);

  let table1 = await readZipText(zip, "xl/tables/table1.xml");
  table1 = stripNonRowVisCalculatedFormulas(table1);
  table1 = setTableRef(table1, `A1:V${lastDataRow}`);
  zip.file("xl/tables/table1.xml", table1);

  // Executive / Performance / Detailed / ChartCache / charts / slicers: leave template as-is
  let contentTypes = await readZipText(zip, "[Content_Types].xml");
  let workbookRels = await readZipText(zip, "xl/_rels/workbook.xml.rels");
  ({contentTypesXml: contentTypes, workbookRelsXml: workbookRels} = stripCalcChainPackageRefs(zip, contentTypes, workbookRels));
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("xl/_rels/workbook.xml.rels", workbookRels);

  let workbook = await readZipText(zip, "xl/workbook.xml");
  if(/<calcPr[\s\S]*?\/>/.test(workbook)){
    workbook = workbook.replace(/<calcPr[^/]*\/>/, '<calcPr calcId="191029" fullCalcOnLoad="1"/>');
  }else if(/<calcPr[\s\S]*?<\/calcPr>/.test(workbook)){
    workbook = workbook.replace(/<calcPr[\s\S]*?<\/calcPr>/, '<calcPr calcId="191029" fullCalcOnLoad="1"/>');
  }else{
    workbook = workbook.replace(/<\/workbook>/, '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
  }
  zip.file("xl/workbook.xml", workbook);

  // createFolders:false avoids empty directory entries that Excel Online may reject
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    createFolders: false
  });
}
