/**
 * Fill Telecalling Lead Audit template via JSZip (preserves slicers/charts).
 * Writes Raw Data + precomputed Executive / Performance / Graphical helpers / Detailed.
 */

const TEMPLATE_URL = new URL("./templates/telecalling-lead-audit.xlsx", import.meta.url).href;

const RAW_HEADERS = [
  "Project Name","Mobile","Telecaller Name","Lead Registration Date","Lead Status","Comments",
  "Next Followup Date","Location","Overdue Days","Status","Analysis Parameter","Customer Requirement",
  "Source","Source Name","Totals","Error Type","Error Details","Recommended Action","Severity",
  "Audit Status","Error Flag"
];

/** cellXfs: 3=date, 4=int, 10=0.0% (from template styles.xml) */
const STYLE={date:3,int:4,pct:10};

function requireJSZip(){
  const JZ=window.JSZip;
  if(typeof JZ!=="function")throw new Error("JSZip failed to load. Check your network connection and reload.");
  return JZ;
}

function xmlEscape(text){
  return String(text??"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function colLetter(n){
  let s="";
  while(n>0){
    const m=(n-1)%26;
    s=String.fromCharCode(65+m)+s;
    n=Math.floor((n-1)/26);
  }
  return s;
}

function clean(value){
  const n=String(value??"").trim().toLowerCase();
  if(["","nan","none","nat","undefined","null"].includes(n))return"";
  return String(value).trim();
}

function parseLooseDate(value){
  if(value instanceof Date&&!Number.isNaN(value.valueOf()))return new Date(value.getTime());
  if(typeof value==="number"&&Number.isFinite(value)){
    // Excel serial
    const utc=Date.UTC(1899,11,30)+Math.round(value*86400000);
    return new Date(utc);
  }
  const s=clean(value);if(!s)return null;
  const iso=s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(iso){
    const d=new Date(Number(iso[1]),Number(iso[2])-1,Number(iso[3]),Number(iso[4]||0),Number(iso[5]||0),Number(iso[6]||0));
    return Number.isNaN(d.valueOf())?null:d;
  }
  const match=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(match){
    const day=Number(match[1]),month=Number(match[2]),year=match[3].length===2?Number(`20${match[3]}`):Number(match[3]);
    if(month>=1&&month<=12&&day>=1&&day<=31){
      const d=new Date(year,month-1,day,Number(match[4]||0),Number(match[5]||0),Number(match[6]||0));
      if(!Number.isNaN(d.valueOf())&&d.getFullYear()===year&&d.getMonth()===month-1&&d.getDate()===day)return d;
    }
  }
  const parsed=new Date(s);
  return Number.isNaN(parsed.valueOf())?null:parsed;
}

function toExcelSerial(date){
  if(!(date instanceof Date)||Number.isNaN(date.valueOf()))return null;
  const utc=Date.UTC(date.getFullYear(),date.getMonth(),date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds());
  return(utc-Date.UTC(1899,11,30))/86400000;
}

function startOfLocalDay(d){
  return new Date(d.getFullYear(),d.getMonth(),d.getDate());
}

function mapSeverity(errorSeverity,errorLabels,highSeverityErrors){
  const sev=String(errorSeverity||"").toUpperCase();
  if(sev==="HIGH")return"Critical";
  if(sev==="MEDIUM")return"Medium";
  if(sev==="NONE"||!errorLabels.length)return"";
  const high=highSeverityErrors instanceof Set?highSeverityErrors:new Set(highSeverityErrors||[]);
  return errorLabels.some(label=>high.has(label))?"Critical":"Medium";
}

function splitErrorLabels(errorTypes){
  const raw=clean(errorTypes);
  if(!raw||/^none$/i.test(raw))return[];
  return raw.split(/\s*\|\s*|\s*,\s*/).map(s=>s.trim()).filter(Boolean).filter(s=>!/^none$/i.test(s));
}

function starRating(accuracy){
  if(accuracy>=0.95)return"★★★★★";
  if(accuracy>=0.9)return"★★★★☆";
  if(accuracy>=0.8)return"★★★☆☆";
  if(accuracy>=0.7)return"★★☆☆☆";
  return"★☆☆☆☆";
}

function formatPeriod(rows){
  const dates=rows.map(r=>r.registrationDate).filter(Boolean).sort((a,b)=>a-b);
  if(!dates.length)return"No data";
  const fmt=d=>d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}).replace(/ /g,"-");
  return`${fmt(dates[0])} to ${fmt(dates[dates.length-1])}`;
}

/** Map LeadLens audit result rows → RawData row objects. */
export function mapResultsToRawDataRows(results,{highSeverityErrors}={}){
  const today=startOfLocalDay(new Date());
  return(results||[]).map(row=>{
    const labels=splitErrorLabels(row.errorTypes);
    const errorFlag=labels.length?1:0;
    const severity=mapSeverity(row.errorSeverity,labels,highSeverityErrors);
    const reg=parseLooseDate(row.registration);
    const next=parseLooseDate(row.next);
    let overdue="";
    if(next){
      overdue=Math.round((today-startOfLocalDay(next))/86400000);
    }
    return{
      project:clean(row.project),
      mobile:clean(row.mobile),
      telecaller:clean(row.telecaller)||"Unknown",
      registration:reg,
      registrationDate:reg?startOfLocalDay(reg):null,
      registrationSerial:reg?toExcelSerial(reg):null,
      status:clean(row.status),
      comments:clean(row.comments),
      next,
      nextSerial:next?toExcelSerial(next):null,
      location:clean(row.location),
      overdue,
      parameter:clean(row.parameter),
      connected:clean(row.connected),
      requirement:clean(row.requirement),
      errorType:labels.length?labels.join(" | "):"None",
      errorLabels:labels,
      errorDetails:clean(row.observation),
      recommendedAction:clean(row.recommendation),
      severity,
      auditStatus:errorFlag?"Error":"Clean",
      errorFlag
    };
  });
}

function buildPerformanceRows(rawRows){
  const by=new Map();
  for(const row of rawRows){
    const name=row.telecaller||"Unknown";
    let agg=by.get(name);
    if(!agg){
      agg={name,leads:0,errors:0,critical:0,medium:0};
      by.set(name,agg);
    }
    agg.leads++;
    if(row.errorFlag){
      agg.errors++;
      if(row.severity==="Critical")agg.critical++;
      else if(row.severity==="Medium")agg.medium++;
    }
  }
  return[...by.values()].map(agg=>{
    const accuracy=agg.leads?Math.max(0,1-agg.errors/agg.leads):0;
    return{
      name:agg.name,
      leads:agg.leads,
      correct:Math.max(0,agg.leads-agg.errors),
      errors:agg.errors,
      accuracy,
      rating:starRating(accuracy),
      critical:agg.critical,
      medium:agg.medium
    };
  }).sort((a,b)=>b.accuracy-a.accuracy||a.name.localeCompare(b.name));
}

function countBy(rows,keyFn){
  const map=new Map();
  for(const row of rows){
    const key=keyFn(row);
    if(!key)continue;
    map.set(key,(map.get(key)||0)+1);
  }
  return[...map.entries()].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])));
}

function buildHelperBlocks(rawRows,performance){
  const errorRows=rawRows.filter(r=>r.errorFlag);
  const teleAccuracy=performance.map(p=>[p.name,p.accuracy]);
  const teleErrors=performance.map(p=>[p.name,p.errors]).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  const typeCounts=new Map();
  for(const row of errorRows){
    for(const label of row.errorLabels){
      typeCounts.set(label,(typeCounts.get(label)||0)+1);
    }
  }
  const typePairs=[...typeCounts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  const projectPairs=countBy(errorRows,r=>r.project||"");
  const sevPairs=[
    ["Critical",rawRows.filter(r=>r.severity==="Critical").length],
    ["Medium",rawRows.filter(r=>r.severity==="Medium").length],
    ["Low",rawRows.filter(r=>!r.severity).length]
  ];
  return{teleAccuracy,teleErrors,typePairs,projectPairs,sevPairs};
}

function buildExecutiveValues(rawRows,performance){
  const totalLeads=rawRows.length;
  const totalErrors=rawRows.reduce((sum,r)=>sum+r.errorFlag,0);
  const accuracy=totalLeads?Math.max(0,1-totalErrors/totalLeads):0;
  const critical=rawRows.filter(r=>r.severity==="Critical").length;
  const medium=rawRows.filter(r=>r.severity==="Medium").length;
  const best=performance[0]?.name||"N/A";
  const worst=[...performance].sort((a,b)=>a.accuracy-b.accuracy||a.name.localeCompare(b.name))[0]?.name||"N/A";
  const period=formatPeriod(rawRows);
  const story=`The audit covers ${totalLeads.toLocaleString()} leads with ${totalErrors.toLocaleString()} errors, producing ${(accuracy*100).toFixed(1)}% overall accuracy. ${critical.toLocaleString()} critical records need immediate correction, while ${medium.toLocaleString()} medium-severity records are coaching opportunities. The top performer is ${best}; management attention should begin with ${worst}.`;
  return{period,totalLeads,totalErrors,accuracy,critical,medium,best,worst,story};
}

function inlineStr(ref,text,style){
  const s=style!=null?` s="${style}"`:"";
  return`<c r="${ref}"${s} t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>`;
}

function numberCell(ref,num,style){
  if(num===null||num===undefined||num==="")return"";
  const s=style!=null?` s="${style}"`:"";
  return`<c r="${ref}"${s}><v>${num}</v></c>`;
}

function buildRawSheetDataXml(rawRows,helpers){
  const parts=[];
  // Header row
  let header=`<row r="1">`;
  RAW_HEADERS.forEach((h,i)=>{header+=inlineStr(`${colLetter(i+1)}1`,h);});
  header+=inlineStr("V1","Accuracy");
  header+=inlineStr("W1","Telecaller");
  header+=inlineStr("X1","Accuracy");
  header+=inlineStr("Z1","Telecaller");
  header+=inlineStr("AA1","Errors");
  header+=inlineStr("AC1","Error Type");
  header+=inlineStr("AD1","Count");
  header+=inlineStr("AF1","Project");
  header+=inlineStr("AG1","Errors");
  header+=inlineStr("AI1","Severity");
  header+=inlineStr("AJ1","Count");
  header+=`</row>`;
  parts.push(header);

  const maxHelper=Math.max(
    rawRows.length,
    helpers.teleAccuracy.length,
    helpers.teleErrors.length,
    helpers.typePairs.length,
    helpers.projectPairs.length,
    helpers.sevPairs.length,
    1
  );

  for(let i=0;i<maxHelper;i++){
    const r=i+2;
    const cells=[];
    if(i<rawRows.length){
      const row=rawRows[i];
      cells.push(inlineStr(`A${r}`,row.project));
      cells.push(inlineStr(`B${r}`,row.mobile));
      cells.push(inlineStr(`C${r}`,row.telecaller));
      if(row.registrationSerial!=null)cells.push(numberCell(`D${r}`,row.registrationSerial,STYLE.date));
      cells.push(inlineStr(`E${r}`,row.status));
      cells.push(inlineStr(`F${r}`,row.comments));
      if(row.nextSerial!=null)cells.push(numberCell(`G${r}`,row.nextSerial,STYLE.date));
      cells.push(inlineStr(`H${r}`,row.location));
      if(row.overdue!=="")cells.push(numberCell(`I${r}`,row.overdue,STYLE.int));
      cells.push(inlineStr(`J${r}`,row.parameter));
      cells.push(inlineStr(`K${r}`,row.connected));
      cells.push(inlineStr(`L${r}`,row.requirement));
      cells.push(inlineStr(`M${r}`,""));
      cells.push(inlineStr(`N${r}`,""));
      cells.push(numberCell(`O${r}`,1));
      cells.push(inlineStr(`P${r}`,row.errorType));
      cells.push(inlineStr(`Q${r}`,row.errorDetails));
      cells.push(inlineStr(`R${r}`,row.recommendedAction));
      cells.push(inlineStr(`S${r}`,row.severity));
      cells.push(inlineStr(`T${r}`,row.auditStatus));
      cells.push(numberCell(`U${r}`,row.errorFlag,STYLE.int));
    }
    if(i<helpers.teleAccuracy.length){
      cells.push(inlineStr(`W${r}`,helpers.teleAccuracy[i][0]));
      cells.push(numberCell(`X${r}`,helpers.teleAccuracy[i][1],STYLE.pct));
    }
    if(i<helpers.teleErrors.length){
      cells.push(inlineStr(`Z${r}`,helpers.teleErrors[i][0]));
      cells.push(numberCell(`AA${r}`,helpers.teleErrors[i][1]));
    }
    if(i<helpers.typePairs.length){
      cells.push(inlineStr(`AC${r}`,helpers.typePairs[i][0]));
      cells.push(numberCell(`AD${r}`,helpers.typePairs[i][1]));
    }
    if(i<helpers.projectPairs.length){
      cells.push(inlineStr(`AF${r}`,helpers.projectPairs[i][0]));
      cells.push(numberCell(`AG${r}`,helpers.projectPairs[i][1]));
    }
    if(i<helpers.sevPairs.length){
      cells.push(inlineStr(`AI${r}`,helpers.sevPairs[i][0]));
      cells.push(numberCell(`AJ${r}`,helpers.sevPairs[i][1]));
    }
    if(cells.length)parts.push(`<row r="${r}">${cells.join("")}</row>`);
  }
  const lastRow=Math.max(1+rawRows.length,1+maxHelper,2);
  const dim=`A1:AJ${lastRow}`;
  return{sheetData:`<sheetData>${parts.join("")}</sheetData>`,dimension:dim,lastDataRow:Math.max(2,1+rawRows.length),helperCounts:{
    teleAccuracy:Math.max(1,helpers.teleAccuracy.length),
    teleErrors:Math.max(1,helpers.teleErrors.length),
    typePairs:Math.max(1,helpers.typePairs.length),
    projectPairs:Math.max(1,helpers.projectPairs.length),
    sevPairs:Math.max(1,helpers.sevPairs.length)
  }};
}

function replaceSheetData(sheetXml,sheetDataXml,dimensionRef){
  let out=sheetXml.replace(/<dimension[^/]*\/>/i,`<dimension ref="${dimensionRef}"/>`);
  out=out.replace(/<sheetData[\s\S]*?<\/sheetData>/i,sheetDataXml);
  return out;
}

function stripCalculatedColumnFormulas(tableXml){
  return tableXml.replace(/<calculatedColumnFormula[\s\S]*?<\/calculatedColumnFormula>/g,"");
}

function setTableRef(tableXml,ref){
  return tableXml
    .replace(/\bref="[^"]*"/,`ref="${ref}"`)
    .replace(/<autoFilter\b([^>]*)\bref="[^"]*"/,`<autoFilter$1ref="${ref}"`);
}

function rebuildTableSheetData(headerRowNum,headers,dataRows,colBuilder){
  const parts=[];
  parts.push(`<row r="${headerRowNum}">${headers.map((h,i)=>inlineStr(`${colLetter(i+1)}${headerRowNum}`,h)).join("")}</row>`);
  dataRows.forEach((row,idx)=>{
    const r=headerRowNum+1+idx;
    parts.push(`<row r="${r}">${colBuilder(row,r)}</row>`);
  });
  // Keep spare empty capacity rows? Table ref will match data length.
  return`<sheetData>${parts.join("")}</sheetData>`;
}

async function readZipText(zip,name){
  const f=zip.file(name);
  if(!f)return null;
  return f.async("string");
}

async function patchCharts(zip,helperCounts){
  const files=[
    "xl/charts/chart1.xml",
    "xl/charts/chart2.xml",
    "xl/charts/chart3.xml",
    "xl/charts/chart4.xml",
    "xl/charts/chart5.xml"
  ];
  for(const file of files){
    const xml=await readZipText(zip,file);
    if(!xml)continue;
    let out=xml;
    out=out.replace(/('Raw Data'!\$W\$2:\$W\$)\d+/g,`$1${1+helperCounts.teleAccuracy}`);
    out=out.replace(/('Raw Data'!\$X\$2:\$X\$)\d+/g,`$1${1+helperCounts.teleAccuracy}`);
    out=out.replace(/('Raw Data'!\$Z\$2:\$Z\$)\d+/g,`$1${1+helperCounts.teleErrors}`);
    out=out.replace(/('Raw Data'!\$AA\$2:\$AA\$)\d+/g,`$1${1+helperCounts.teleErrors}`);
    out=out.replace(/('Raw Data'!\$AC\$2:\$AC\$)\d+/g,`$1${1+helperCounts.typePairs}`);
    out=out.replace(/('Raw Data'!\$AD\$2:\$AD\$)\d+/g,`$1${1+helperCounts.typePairs}`);
    out=out.replace(/('Raw Data'!\$AF\$2:\$AF\$)\d+/g,`$1${1+helperCounts.projectPairs}`);
    out=out.replace(/('Raw Data'!\$AG\$2:\$AG\$)\d+/g,`$1${1+helperCounts.projectPairs}`);
    out=out.replace(/('Raw Data'!\$AI\$2:\$AI\$)\d+/g,`$1${1+helperCounts.sevPairs}`);
    out=out.replace(/('Raw Data'!\$AJ\$2:\$AJ\$)\d+/g,`$1${1+helperCounts.sevPairs}`);
    zip.file(file,out);
  }
}

async function fillPerformanceSheet(zip,performance){
  let sheet=await readZipText(zip,"xl/worksheets/sheet4.xml");
  const headers=["Telecaller Name","Leads Audited","Correct Records","Total Errors","Accuracy %","Rating","Critical Errors","Medium Errors"];
  const titleRows=`<row r="1">${inlineStr("A1","Telecaller Performance")}</row>`+
    `<row r="2">${inlineStr("A2","Ranked scorecard counting every audit error triggered per lead")}</row>`+
    `<row r="4">${inlineStr("A4","PERFORMANCE SCORECARD")}</row>`;
  const dataXml=rebuildTableSheetData(5,headers,performance,(row,r)=>[
    inlineStr(`A${r}`,row.name),
    numberCell(`B${r}`,row.leads),
    numberCell(`C${r}`,row.correct),
    numberCell(`D${r}`,row.errors),
    numberCell(`E${r}`,row.accuracy,STYLE.pct),
    inlineStr(`F${r}`,row.rating),
    numberCell(`G${r}`,row.critical),
    numberCell(`H${r}`,row.medium)
  ].join(""));
  const last=5+Math.max(performance.length,1);
  const inner=dataXml.replace(/^<sheetData>/,"").replace(/<\/sheetData>$/,"");
  const merged=`<sheetData>${titleRows}${inner}</sheetData>`;
  sheet=replaceSheetData(sheet,merged,`A1:H${last}`);
  zip.file("xl/worksheets/sheet4.xml",sheet);

  let table=await readZipText(zip,"xl/tables/table2.xml");
  table=stripCalculatedColumnFormulas(table);
  table=setTableRef(table,`A5:H${Math.max(6,5+performance.length)}`);
  zip.file("xl/tables/table2.xml",table);
}

async function fillDetailedSheet(zip,rawRows){
  const errors=rawRows.filter(r=>r.errorFlag);
  let sheet=await readZipText(zip,"xl/worksheets/sheet6.xml");
  const headers=["Project Name","Mobile Number","Telecaller Name","Lead Registration Date","Current Lead Status","CRM Status","Comments","Error Type","Error Details","Recommended Action","Severity","Audit Status"];
  const titleRows=`<row r="1">${inlineStr("A1","Detailed Error Report")}</row>`+
    `<row r="2">${inlineStr("A2","Filter any column to search mobile, project, telecaller, severity, or status")}</row>`+
    `<row r="4">${inlineStr("A4","RECORD-LEVEL AUDIT EXCEPTIONS")}</row>`;
  const dataXml=rebuildTableSheetData(5,headers,errors,(row,r)=>[
    inlineStr(`A${r}`,row.project),
    inlineStr(`B${r}`,row.mobile),
    inlineStr(`C${r}`,row.telecaller),
    row.registrationSerial!=null?numberCell(`D${r}`,row.registrationSerial,STYLE.date):"",
    inlineStr(`E${r}`,row.status),
    inlineStr(`F${r}`,row.parameter),
    inlineStr(`G${r}`,row.comments),
    inlineStr(`H${r}`,row.errorType),
    inlineStr(`I${r}`,row.errorDetails),
    inlineStr(`J${r}`,row.recommendedAction),
    inlineStr(`K${r}`,row.severity),
    inlineStr(`L${r}`,row.auditStatus)
  ].join(""));
  const last=5+Math.max(errors.length,1);
  const inner=dataXml.replace(/^<sheetData>/,"").replace(/<\/sheetData>$/,"");
  const merged=`<sheetData>${titleRows}${inner}</sheetData>`;
  sheet=replaceSheetData(sheet,merged,`A1:L${last}`);
  zip.file("xl/worksheets/sheet6.xml",sheet);

  let table=await readZipText(zip,"xl/tables/table3.xml");
  table=stripCalculatedColumnFormulas(table);
  table=setTableRef(table,`A5:L${Math.max(6,5+errors.length)}`);
  zip.file("xl/tables/table3.xml",table);
}

async function fillExecutiveSheet(zip,exec){
  let sheet=await readZipText(zip,"xl/worksheets/sheet3.xml");
  const criticalFormula=`COUNTIF(RawData[Severity],"Critical")`;
  const mediumFormula=`COUNTIF(RawData[Severity],"Medium")`;
  const replaceCell=(ref,openAttrs,inner)=>{
    const re=new RegExp(`<c r="${ref}"[^>]*(?:/>|>[\\s\\S]*?</c>)`);
    const cell=`<c r="${ref}"${openAttrs}>${inner}</c>`;
    if(re.test(sheet))sheet=sheet.replace(re,cell);
  };
  replaceCell("A5",` t="inlineStr"`,`<is><t>${xmlEscape(exec.period)}</t></is>`);
  replaceCell("C5","",`<v>${exec.totalLeads}</v>`);
  replaceCell("E5","",`<v>${exec.totalErrors}</v>`);
  replaceCell("G5",` s="${STYLE.pct}"`,`<v>${exec.accuracy}</v>`);
  replaceCell("A9","",`<f>${xmlEscape(criticalFormula)}</f><v>${exec.critical}</v>`);
  replaceCell("C9","",`<f>${xmlEscape(mediumFormula)}</f><v>${exec.medium}</v>`);
  replaceCell("E9",` t="inlineStr"`,`<is><t>${xmlEscape(exec.best)}</t></is>`);
  replaceCell("G9",` t="inlineStr"`,`<is><t>${xmlEscape(exec.worst)}</t></is>`);
  replaceCell("A13",` t="inlineStr"`,`<is><t>${xmlEscape(exec.story)}</t></is>`);
  zip.file("xl/worksheets/sheet3.xml",sheet);
}

async function loadTemplateBytes(templateUrl=TEMPLATE_URL){
  const res=await fetch(templateUrl,{cache:"no-store"});
  if(!res.ok)throw new Error(`Could not load dashboard template (${res.status}).`);
  return res.arrayBuffer();
}

/**
 * Build a finished dashboard workbook blob from audit result rows.
 * @param {object[]} results LeadLens result rows
 * @param {{highSeverityErrors?: Set<string>|string[], templateUrl?: string}} [options]
 */
export async function buildTelecallerDashboardBlob(results,options={}){
  const JSZip=requireJSZip();
  const rawRows=mapResultsToRawDataRows(results,{highSeverityErrors:options.highSeverityErrors});
  if(!rawRows.length)throw new Error("No audited rows to put in the dashboard.");
  const performance=buildPerformanceRows(rawRows);
  const helpers=buildHelperBlocks(rawRows,performance);
  const exec=buildExecutiveValues(rawRows,performance);
  const{sheetData,dimension,lastDataRow,helperCounts}=buildRawSheetDataXml(rawRows,helpers);

  const bytes=await loadTemplateBytes(options.templateUrl||TEMPLATE_URL);
  const zip=await JSZip.loadAsync(bytes);

  let sheet2=await readZipText(zip,"xl/worksheets/sheet2.xml");
  sheet2=replaceSheetData(sheet2,sheetData,dimension);
  zip.file("xl/worksheets/sheet2.xml",sheet2);

  let table1=await readZipText(zip,"xl/tables/table1.xml");
  table1=stripCalculatedColumnFormulas(table1);
  table1=setTableRef(table1,`A1:U${lastDataRow}`);
  zip.file("xl/tables/table1.xml",table1);

  await fillPerformanceSheet(zip,performance);
  await fillDetailedSheet(zip,rawRows);
  await fillExecutiveSheet(zip,exec);
  await patchCharts(zip,helperCounts);

  if(zip.file("xl/calcChain.xml"))zip.remove("xl/calcChain.xml");

  let workbook=await readZipText(zip,"xl/workbook.xml");
  if(/<calcPr[\s\S]*?\/>/.test(workbook)){
    workbook=workbook.replace(/<calcPr[^/]*\/>/,'<calcPr calcId="191029" fullCalcOnLoad="1"/>');
  }else if(/<calcPr[\s\S]*?<\/calcPr>/.test(workbook)){
    workbook=workbook.replace(/<calcPr[\s\S]*?<\/calcPr>/,'<calcPr calcId="191029" fullCalcOnLoad="1"/>');
  }else{
    workbook=workbook.replace(/<\/workbook>/,'<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
  }
  zip.file("xl/workbook.xml",workbook);

  return zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
