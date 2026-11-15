/* Серверная проверка: разбор текста, ссылок и файлов. Используется ботом в чатах (/check). */
/* ===== помощники для новых инструментов ===== */
const jget=async(u,o={})=>{const r=await fetch(u,{signal:AbortSignal.timeout(15000),...o});if(!r.ok){const e=new Error("HTTP "+r.status);e.status=r.status;throw e}return r.json()};
const ptext=async u=>{const r=await fetch("https://api.allorigins.win/get?url="+encodeURIComponent(u),{signal:AbortSignal.timeout(20000)});const j=await r.json();return {text:String(j.contents||""),code:(j.status||{}).http_code||0}};
const pad2=n=>String(n).padStart(2,"0");
const fmtD=d=>d.getUTCFullYear()+"-"+pad2(d.getUTCMonth()+1)+"-"+pad2(d.getUTCDate())+" "+pad2(d.getUTCHours())+":"+pad2(d.getUTCMinutes())+" UTC";
const num=(x,n=6)=>{const s=Number(x).toFixed(n);return s.includes(".")?s.replace(/0+$/,"").replace(/\.$/,""):s};
const parseUtc=s=>{
  s=String(s).trim();if(!s)return null;
  if(/^\d{9,10}$/.test(s))return new Date(+s*1000);
  if(/^\d{12,13}$/.test(s))return new Date(+s);
  const m=s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  let x;
  if(m){x=`${m[3]}-${pad2(m[2])}-${pad2(m[1])}T${pad2(m[4]||0)}:${m[5]||"00"}:${m[6]||"00"}${m[7]||"Z"}`}
  else{
    x=s.replace(/\s+(?=[+-]\d{2}:?\d{2}$|Z$)/i,"").replace(" ","T");
    if(/^\d{4}-\d{2}-\d{2}$/.test(x))x+="T00:00:00";
    if(!/(Z|[+-]\d{2}:?\d{2})$/i.test(x))x+="Z";
  }
  x=x.replace(/([+-]\d{2})(\d{2})$/,"$1:$2");
  const d=new Date(x);return isNaN(d)?null:d;
};
const parsePt=s=>{
  const m=String(s).replace(/[;|,]/g," ").trim().split(/\s+/).map(Number);
  return m.length>=2&&m.every(x=>!isNaN(x))&&Math.abs(m[0])<=90&&Math.abs(m[1])<=180?[m[0],m[1]]:null;
};

/* --- EXIF --- */
function parseExif(buf){
  const dv=new DataView(buf);const L=dv.byteLength;
  let tiff=-1;
  if(L>4&&dv.getUint16(0)===0xFFD8){
    let off=2;
    while(off<L-4){
      const m=dv.getUint16(off);
      if(m===0xFFE1&&dv.getUint32(off+4)===0x45786966){tiff=off+10;break}
      if((m&0xFF00)!==0xFF00)break;
      off+=2+dv.getUint16(off+2);
    }
  }else if(L>8&&dv.getUint32(0)===0x89504E47){
    let off=8;
    while(off<L-12){
      const len=dv.getUint32(off),type=dv.getUint32(off+4);
      if(type===0x65584966){tiff=off+8;break}
      off+=12+len;
    }
  }else if(L>12&&dv.getUint32(0)===0x52494646&&dv.getUint32(8)===0x57454250){
    let off=12;
    while(off<L-8){
      const type=dv.getUint32(off),len=dv.getUint32(off+4,true);
      if(type===0x45584946){tiff=off+8;if(dv.getUint32(tiff)===0x45786966)tiff+=6;break}
      off+=8+len+(len&1);
    }
  }else if(L>8&&(dv.getUint16(0)===0x4949||dv.getUint16(0)===0x4D4D)){tiff=0}
  if(tiff<0||tiff+8>L)return null;
  const le=dv.getUint16(tiff)===0x4949;
  const g16=o=>dv.getUint16(o,le),g32=o=>dv.getUint32(o,le);
  if(g16(tiff+2)!==42)return null;
  const SZ={1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8};
  const readIFD=o=>{
    const out={};
    try{
      const n=g16(o);
      for(let i=0;i<n&&i<300;i++){
        const e=o+2+i*12;
        const tag=g16(e),type=g16(e+2),cnt=g32(e+4);
        const size=(SZ[type]||1)*cnt;
        const vo=size>4?tiff+g32(e+8):e+8;
        if(vo+size>L)continue;
        let val=null;
        if(type===2){let s="";for(let k=0;k<cnt-1&&k<500;k++)s+=String.fromCharCode(dv.getUint8(vo+k));val=s.replace(/\0+$/,"").trim()}
        else if(type===3){val=[];for(let k=0;k<Math.min(cnt,32);k++)val.push(g16(vo+2*k))}
        else if(type===4){val=[];for(let k=0;k<Math.min(cnt,32);k++)val.push(g32(vo+4*k))}
        else if(type===5||type===10){val=[];for(let k=0;k<Math.min(cnt,8);k++){const a=type===5?g32(vo+8*k):dv.getInt32(vo+8*k,le),b=type===5?g32(vo+8*k+4):dv.getInt32(vo+8*k+4,le);val.push(b?a/b:0)}}
        else if(type===1||type===7){val=[];for(let k=0;k<Math.min(cnt,64);k++)val.push(dv.getUint8(vo+k))}
        out[tag]=(Array.isArray(val)&&val.length===1)?val[0]:val;
      }
    }catch(e){}
    return out;
  };
  const ifd0=readIFD(tiff+g32(tiff+4));
  const exif=typeof ifd0[0x8769]==="number"?readIFD(tiff+ifd0[0x8769]):{};
  const gps=typeof ifd0[0x8825]==="number"?readIFD(tiff+ifd0[0x8825]):{};
  return {ifd0,exif,gps};
}

/* --- координаты --- */
function toUTM(lat,lon){
  const a=6378137,f=1/298.257223563,k0=0.9996,e2=f*(2-f),ep2=e2/(1-e2);
  const zone=Math.floor((lon+180)/6)+1;
  const lon0=((zone-1)*6-180+3)*Math.PI/180,phi=lat*Math.PI/180,lam=lon*Math.PI/180;
  const N=a/Math.sqrt(1-e2*Math.sin(phi)**2),T=Math.tan(phi)**2,C=ep2*Math.cos(phi)**2,A=Math.cos(phi)*(lam-lon0);
  const M=a*((1-e2/4-3*e2*e2/64-5*e2**3/256)*phi-(3*e2/8+3*e2*e2/32+45*e2**3/1024)*Math.sin(2*phi)+(15*e2*e2/256+45*e2**3/1024)*Math.sin(4*phi)-(35*e2**3/3072)*Math.sin(6*phi));
  const x=k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120)+500000;
  let y=k0*(M+N*Math.tan(phi)*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720));
  if(lat<0)y+=10000000;
  const band="CDEFGHJKLMNPQRSTUVWX"[Math.max(0,Math.min(19,Math.floor((lat+80)/8)))];
  return {zone,band,x:Math.round(x),y:Math.round(y)};
}
function plusCode(lat,lon){
  const A="23456789CFGHJMPQRVWX";
  let la=Math.min(Math.max(lat,-90),89.9999999)+90,lo=(((lon+180)%360)+360)%360,res=20,c="";
  for(let i=0;i<5;i++){
    const di=Math.floor(la/res);la-=di*res;
    const dj=Math.floor(lo/res);lo-=dj*res;
    c+=A[di]+A[dj];res/=20;
  }
  return c.slice(0,8)+"+"+c.slice(8);
}
function geohash(lat,lon,len=10){
  const B="0123456789bcdefghjkmnpqrstuvwxyz";
  let lo=[-90,90],lg=[-180,180],even=true,bit=0,ch=0,s="";
  while(s.length<len){
    const r=even?lg:lo,v=even?lon:lat,mid=(r[0]+r[1])/2;
    if(v>mid){ch=ch*2+1;r[0]=mid}else{ch=ch*2;r[1]=mid}
    even=!even;
    if(++bit===5){s+=B[ch];bit=0;ch=0}
  }
  return s;
}
const dmsF=(x,p,n)=>{const q=Math.abs(x),dg=Math.floor(q),mi=Math.floor((q-dg)*60),sc=((q-dg)*60-mi)*60;return dg+"°"+mi+"'"+sc.toFixed(1)+'"'+(x>=0?p:n)};

/* --- солнце (алгоритм SunCalc) --- */
const SUN=(()=>{
  const rad=Math.PI/180,dayMs=864e5,J1970=2440588,J2000=2451545,e=rad*23.4397;
  const toJ=d=>d.valueOf()/dayMs-0.5+J1970,toDays=d=>toJ(d)-J2000;
  const ra=(l,b)=>Math.atan2(Math.sin(l)*Math.cos(e)-Math.tan(b)*Math.sin(e),Math.cos(l));
  const dec=(l,b)=>Math.asin(Math.sin(b)*Math.cos(e)+Math.cos(b)*Math.sin(e)*Math.sin(l));
  const az=(H,phi,d)=>Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(d)*Math.cos(phi));
  const alt=(H,phi,d)=>Math.asin(Math.sin(phi)*Math.sin(d)+Math.cos(phi)*Math.cos(d)*Math.cos(H));
  const sid=(d,lw)=>rad*(280.16+360.9856235*d)-lw;
  const mAn=d=>rad*(357.5291+0.98560028*d);
  const eclL=M=>{const C=rad*(1.9148*Math.sin(M)+0.02*Math.sin(2*M)+0.0003*Math.sin(3*M)),P=rad*102.9372;return M+C+P+Math.PI};
  const J0=0.0009;
  const cyc=(d,lw)=>Math.round(d-J0-lw/(2*Math.PI));
  const appr=(Ht,lw,n)=>J0+(Ht+lw)/(2*Math.PI)+n;
  const transit=(ds,M,L)=>J2000+ds+0.0053*Math.sin(M)-0.0069*Math.sin(2*L);
  const hAng=(h,phi,d)=>Math.acos((Math.sin(h)-Math.sin(phi)*Math.sin(d))/(Math.cos(phi)*Math.cos(d)));
  const fromJ=j=>new Date((j+0.5-J1970)*dayMs);
  return {
    pos(date,lat,lng){
      const lw=rad*-lng,phi=rad*lat,d=toDays(date),M=mAn(d),L=eclL(M),dc=dec(L,0),r=ra(L,0),H=sid(d,lw)-r;
      return {az:((az(H,phi,dc)/rad+180)%360+360)%360,alt:alt(H,phi,dc)/rad};
    },
    times(date,lat,lng){
      const lw=rad*-lng,phi=rad*lat,d=toDays(date),n=cyc(d,lw),ds=appr(0,lw,n),M=mAn(ds),L=eclL(M),dc=dec(L,0),Jn=transit(ds,M,L);
      const w=hAng(-0.833*rad,phi,dc),a=appr(w,lw,n),Js=transit(a,M,L),Jr=Jn-(Js-Jn);
      const ok=x=>isNaN(x)?null:fromJ(x);
      return {noon:ok(Jn),sunrise:ok(Jr),sunset:ok(Js)};
    }
  };
})();

/* --- крипто --- */
const B58="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
async function b58check(s){
  let n=0n;
  for(const c of s){const i=B58.indexOf(c);if(i<0)return false;n=n*58n+BigInt(i)}
  let hex=n.toString(16);if(hex.length%2)hex="0"+hex;
  const bytes=n===0n?[]:hex.match(/../g).map(x=>parseInt(x,16));
  let z=0;for(const c of s){if(c==="1")z++;else break}
  const full=new Uint8Array(z+bytes.length);full.set(bytes,z);
  if(full.length<5)return false;
  const body=full.slice(0,-4),chk=full.slice(-4);
  const h=new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(await crypto.subtle.digest("SHA-256",body))));
  return chk.every((b,i)=>b===h[i]);
}

/* --- банки, регионы --- */
const ibanOk=s=>{const r=s.slice(4)+s.slice(0,4);let rem=0;for(const ch of r){const v=/\d/.test(ch)?ch:String(ch.charCodeAt(0)-55);for(const c of v)rem=(rem*10+ +c)%97}return rem===1};
const IBL={DE:[22,"Германия"],PL:[28,"Польша"],GB:[22,"Великобритания"],FR:[27,"Франция"],ES:[24,"Испания"],IT:[27,"Италия"],NL:[18,"Нидерланды"],UA:[29,"Украина"],BY:[28,"Беларусь"],KZ:[20,"Казахстан"],GE:[22,"Грузия"],LT:[20,"Литва"],LV:[21,"Латвия"],EE:[20,"Эстония"],CZ:[24,"Чехия"],SK:[24,"Словакия"],AT:[20,"Австрия"],CH:[21,"Швейцария"],TR:[26,"Турция"],AE:[23,"ОАЭ"],IL:[23,"Израиль"],RO:[24,"Румыния"],BG:[22,"Болгария"],PT:[25,"Португалия"],SE:[24,"Швеция"],BE:[16,"Бельгия"],FI:[18,"Финляндия"],DK:[18,"Дания"],NO:[15,"Норвегия"],IE:[22,"Ирландия"],GR:[27,"Греция"],HU:[28,"Венгрия"],RS:[22,"Сербия"],MD:[24,"Молдова"],AZ:[28,"Азербайджан"],LU:[20,"Люксембург"]};
const cardBrand=d=>/^220[0-4]/.test(d)?"Мир":/^4/.test(d)?"Visa":/^(5[1-5]|2[2-7])/.test(d)?"Mastercard":/^3[47]/.test(d)?"American Express":/^62/.test(d)?"UnionPay":/^(50|5[6-9]|6)/.test(d)?"Maestro или другая":"не определена";
const RG_MAIN="01 Республика Адыгея;02 Республика Башкортостан;03 Республика Бурятия;04 Республика Алтай;05 Республика Дагестан;06 Республика Ингушетия;07 Кабардино-Балкарская Республика;08 Республика Калмыкия;09 Карачаево-Черкесская Республика;10 Республика Карелия;11 Республика Коми;12 Республика Марий Эл;13 Республика Мордовия;14 Республика Саха (Якутия);15 Республика Северная Осетия — Алания;16 Республика Татарстан;17 Республика Тыва;18 Удмуртская Республика;19 Республика Хакасия;20 Чеченская Республика;21 Чувашская Республика;22 Алтайский край;23 Краснодарский край;24 Красноярский край;25 Приморский край;26 Ставропольский край;27 Хабаровский край;28 Амурская область;29 Архангельская область;30 Астраханская область;31 Белгородская область;32 Брянская область;33 Владимирская область;34 Волгоградская область;35 Вологодская область;36 Воронежская область;37 Ивановская область;38 Иркутская область;39 Калининградская область;40 Калужская область;41 Камчатский край;42 Кемеровская область;43 Кировская область;44 Костромская область;45 Курганская область;46 Курская область;47 Ленинградская область;48 Липецкая область;49 Магаданская область;50 Московская область;51 Мурманская область;52 Нижегородская область;53 Новгородская область;54 Новосибирская область;55 Омская область;56 Оренбургская область;57 Орловская область;58 Пензенская область;59 Пермский край;60 Псковская область;61 Ростовская область;62 Рязанская область;63 Самарская область;64 Саратовская область;65 Сахалинская область;66 Свердловская область;67 Смоленская область;68 Тамбовская область;69 Тверская область;70 Томская область;71 Тульская область;72 Тюменская область;73 Ульяновская область;74 Челябинская область;75 Забайкальский край;76 Ярославская область;77 Москва;78 Санкт-Петербург;79 Еврейская автономная область;83 Ненецкий автономный округ;86 Ханты-Мансийский автономный округ;87 Чукотский автономный округ;89 Ямало-Ненецкий автономный округ;92 Севастополь";
const RG=Object.fromEntries(RG_MAIN.split(";").map(x=>[x.slice(0,2),x.slice(3)]));
const RG_PLATE_EXTRA={"102":"02","702":"02","103":"03","113":"13","116":"16","716":"16","118":"18","121":"21","122":"22","93":"23","123":"23","84":"24","88":"24","124":"24","125":"25","126":"26","127":"27","134":"34","136":"36","85":"38","138":"38","91":"39","142":"42","90":"50","150":"50","190":"50","750":"50","152":"52","154":"54","81":"59","159":"59","161":"61","163":"63","164":"64","96":"66","196":"66","173":"73","174":"74","80":"75","97":"77","99":"77","177":"77","197":"77","199":"77","777":"77","797":"77","799":"77","98":"78","178":"78","186":"86","95":"20"};
const regPlate=c=>c==="82"?"Республика Крым":(RG[c]||(RG_PLATE_EXTRA[c]?RG[RG_PLATE_EXTRA[c]]:null));
const regTax=c=>c==="91"?"Республика Крым":c==="99"?"Байконур и иные территории":(RG[c]||null);

/* --- шифры --- */
const MORSE_L={A:".-",B:"-...",C:"-.-.",D:"-..",E:".",F:"..-.",G:"--.",H:"....",I:"..",J:".---",K:"-.-",L:".-..",M:"--",N:"-.",O:"---",P:".--.",Q:"--.-",R:".-.",S:"...",T:"-",U:"..-",V:"...-",W:".--",X:"-..-",Y:"-.--",Z:"--..",0:"-----",1:".----",2:"..---",3:"...--",4:"....-",5:".....",6:"-....",7:"--...",8:"---..",9:"----."};
const MORSE_C={А:".-",Б:"-...",В:".--",Г:"--.",Д:"-..",Е:".",Ж:"...-",З:"--..",И:"..",Й:".---",К:"-.-",Л:".-..",М:"--",Н:"-.",О:"---",П:".--.",Р:".-.",С:"...",Т:"-",У:"..-",Ф:"..-.",Х:"....",Ц:"-.-.",Ч:"---.",Ш:"----",Щ:"--.-",Ъ:"--.--",Ы:"-.--",Ь:"-..-",Э:"..-..",Ю:"..--",Я:".-.-"};
const rot=(t,k,alpha)=>[...t].map(c=>{const up=c===c.toUpperCase()&&c!==c.toLowerCase();const i=alpha.indexOf(c.toUpperCase());if(i<0)return c;const r=alpha[((i+k)%alpha.length+alpha.length)%alpha.length];return up||c===c.toUpperCase()?r:r.toLowerCase()}).join("");
const LAT="ABCDEFGHIJKLMNOPQRSTUVWXYZ",CYR="АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ";

const innC=(d,w)=>d.reduce((a,x,i)=>a+x*w[i],0)%11%10;

const innOk = s => {
  if(!/^\d{10}$/.test(s) && !/^\d{12}$/.test(s)) return false;
  const d=[...s].map(Number);
  const c1=innC(d.slice(0,9),[2,4,10,3,5,9,4,6,8]);
  if(s.length===10) return c1===d[9];
  const c11=innC(d.slice(0,10),[7,2,4,10,3,5,9,4,6,8]);
  const c12=innC(d.slice(0,11),[3,7,2,4,10,3,5,9,4,6,8]);
  return c11===d[10] && c12===d[11];
};
const ogrnOk = s => {
  if(!/^\d{13}$/.test(s) && !/^\d{15}$/.test(s)) return false;
  const m = s.length===13 ? 11n : 13n;
  return (BigInt(s.slice(0,-1)) % m) % 10n === BigInt(s[s.length-1]);
};
const snilsOk = s => {
  if(!/^\d{11}$/.test(s)) return false;
  const d=[...s].map(Number);
  let sum=0; for(let i=0;i<9;i++) sum+=d[i]*(9-i);
  let c = sum<100 ? sum : (sum===100||sum===101 ? 0 : sum%101);
  if(c===100||c===101) c=0;
  return c === d[9]*10+d[10];
};
const luhnOk = s => {
  if(!/^\d{12,19}$/.test(s)) return false;
  let sum=0, alt=false;
  for(let i=s.length-1;i>=0;i--){ let n=+s[i]; if(alt){ n*=2; if(n>9) n-=9 } sum+=n; alt=!alt }
  return sum%10===0;
};
const VW=[8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
const VM={A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9};
const vinOk = s => {
  if(!/^[A-HJ-NPR-Z0-9]{17}$/i.test(s)) return false;
  const u=s.toUpperCase();
  let sum=0; for(let i=0;i<17;i++){ const c=u[i]; sum += (/\d/.test(c) ? +c : VM[c]) * VW[i] }
  const r=sum%11;
  return (r===10?"X":String(r)) === u[8];
};
const kppOk = s => /^\d{4}[0-9A-Z]{2}\d{3}$/.test(s);

/* ================= разбор запроса и ответ текстом ================= */
/* обрезаем по границе строки, чтобы не разорвать html-теги */
const trunc = (s, n = 3600) => { if (s.length <= n) return s; const i = s.lastIndexOf("\n", n); return s.slice(0, i > 0 ? i : n) + "\n…"; };
const H = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const A = (t, u) => `<a href="${H(u).replace(/"/g, "&quot;")}">${H(t)}</a>`;
const UA = { "User-Agent": "OSINTHub/1.0 (+telegram bot)" };
const cut = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
/* строка «ключ: значение», пустые значения пропускаются; v уже безопасный html, если raw */
const ln = (k, v, raw) => (v == null || v === "" ? "" : `${H(k)}: ${raw ? v : H(v)}\n`);
const head = (icon, t) => `${icon} <b>${H(t)}</b>\n`;
const lnk = (arr) => arr.map(([t, u]) => A(t, u)).join(" · ") + "\n";
const dt = (x) => { const d = new Date(x); return isNaN(d) ? "" : d.toISOString().slice(0, 10); };
const doh = async (n, t) => { try { const j = await jget("https://dns.google/resolve?name=" + encodeURIComponent(n) + "&type=" + t); return (j.Answer || []).filter((a) => !t || a.type === ({ A: 1, AAAA: 28, MX: 15, NS: 2, TXT: 16, CNAME: 5 }[t] || a.type)).map((a) => a.data); } catch (e) { return []; } };
const hexOf = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
const digest = async (algo, data) => hexOf(await crypto.subtle.digest(algo, data));
const SLD = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);
const regDom = (h) => { const p = h.toLowerCase().split("."); return p.length > 2 && p[p.length - 2].length <= 3 && SLD.has(p[p.length - 2]) ? p.slice(-3).join(".") : p.slice(-2).join("."); };
const SHORT = /^(bit\.ly|t\.co|tinyurl\.com|goo\.gl|cutt\.ly|clck\.ru|is\.gd|rb\.gy|ow\.ly|buff\.ly|tiny\.cc|vk\.cc|shorturl\.at|t\.ly|lnkd\.in)$/i;
const DISPOSABLE = /^(mailinator\.com|10minutemail\.com|guerrillamail\.com|tempmail\.[a-z]+|temp-mail\.org|yopmail\.com|trashmail\.com|sharklasers\.com|getnada\.com|dispostable\.com|maildrop\.cc|throwawaymail\.com|fakeinbox\.com|moakt\.com)$/i;

/* ---- домен ---- */
async function aDomain(d, short) {
  d = d.toLowerCase();
  const rd = regDom(d);
  const [a, mx, ns, rdap] = await Promise.all([
    doh(d, "A"), short ? [] : doh(d, "MX"), short ? [] : doh(rd, "NS"),
    jget("https://rdap.org/domain/" + encodeURIComponent(rd)).catch(() => null),
  ]);
  let o = "";
  o += ln("IP", a.slice(0, 4).join(", ") || "не резолвится");
  if (!short) { o += ln("MX", mx.slice(0, 3).map((x) => x.replace(/^\d+\s+/, "").replace(/\.$/, "")).join(", ") || "нет (почта не принимается)"); o += ln("NS", ns.slice(0, 3).map((x) => x.replace(/\.$/, "")).join(", ")); }
  if (rdap) {
    const ev = (k) => { const e = (rdap.events || []).find((x) => x.eventAction === k); return e ? dt(e.eventDate) : ""; };
    const reg = ev("registration");
    let age = "";
    if (reg) { const days = Math.floor((Date.now() - Date.parse(reg)) / 864e5); age = days < 365 ? ` (${days} дн.)` : ` (${(days / 365).toFixed(1)} г.)`; }
    o += ln("Зарегистрирован", reg ? reg + age : "");
    o += ln("Истекает", ev("expiration"));
    const rg = (rdap.entities || []).find((e) => (e.roles || []).includes("registrar"));
    const fn = rg && rg.vcardArray && (rg.vcardArray[1] || []).find((x) => x[0] === "fn");
    o += ln("Регистратор", fn && fn[3]);
    if (reg && Date.now() - Date.parse(reg) < 30 * 864e5) o += "⚠️ Домен младше 30 дней\n";
  } else o += ln("Whois", "не получен");
  return o;
}

/* ---- ссылка ---- */
async function aUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return head("🔗", "Ссылка") + "Не удалось разобрать.\n"; }
  const host = u.hostname;
  let o = head("🔗", "Ссылка");
  o += ln("Сайт", host);
  if (/xn--/.test(host)) o += "⚠️ Домен в punycode: возможна подмена символов\n";
  if (SHORT.test(host)) o += "⚠️ Сократитель ссылок\n";
  if (u.username || u.password) o += "⚠️ В адресе есть логин или пароль: частый признак обмана\n";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) o += "⚠️ Вместо домена IP-адрес\n";
  /* цепочка переходов */
  let cur = u.href, hops = [], title = "", final = u.href, status = 0, ctype = "";
  try {
    for (let i = 0; i < 6; i++) {
      const r = await fetch(cur, { redirect: "manual", headers: UA, signal: AbortSignal.timeout(7000) });
      status = r.status; final = cur;
      const loc = r.headers.get("location");
      if (status >= 300 && status < 400 && loc) { cur = new URL(loc, cur).href; hops.push(cur); continue; }
      ctype = r.headers.get("content-type") || "";
      if (/html/i.test(ctype)) { const t = (await r.text()).slice(0, 120000); const m = t.match(/<title[^>]*>([\s\S]*?)<\/title>/i); title = m ? m[1].replace(/\s+/g, " ").trim() : ""; }
      break;
    }
    o += ln("Ответ", status ? "HTTP " + status : "");
    if (hops.length) { o += ln("Перенаправлений", String(hops.length)); o += ln("Конечный адрес", cut(final, 200)); const fh = new URL(final).hostname; if (fh !== host) o += ln("Конечный сайт", fh); }
    o += ln("Заголовок", cut(title, 120));
    if (!/html|text/i.test(ctype) && ctype) o += ln("Тип файла", ctype.split(";")[0]);
  } catch (e) { o += "Сайт не отвечает или закрыт.\n"; }
  o += "\n" + head("🌐", "Домен") + (await aDomain(host, true));
  o += lnk([["urlscan", "https://urlscan.io/search/#" + encodeURIComponent(host)], ["VirusTotal", "https://www.virustotal.com/gui/domain/" + host], ["Archive", "https://web.archive.org/web/*/" + u.href]]);
  return o;
}

/* ---- IP ---- */
async function aIp(ip) {
  const [g, p] = await Promise.all([
    jget("https://ipwho.is/" + encodeURIComponent(ip)).catch(() => null),
    jget("https://stat.ripe.net/data/prefix-overview/data.json?resource=" + encodeURIComponent(ip)).catch(() => null),
  ]);
  let o = head("🖧", "IP " + ip);
  if (g && g.success !== false) {
    o += ln("Страна", [g.flag && g.flag.emoji, g.country].filter(Boolean).join(" "));
    o += ln("Город", [g.region, g.city].filter(Boolean).join(", "));
    o += ln("Провайдер", g.connection && (g.connection.isp || g.connection.org));
    o += ln("AS", g.connection && g.connection.asn ? "AS" + g.connection.asn + (g.connection.org ? " · " + g.connection.org : "") : "");
    o += ln("Часовой пояс", g.timezone && g.timezone.id);
    if (g.latitude != null) o += ln("Координаты", num(g.latitude, 4) + ", " + num(g.longitude, 4));
    o += "ℹ️ Геолокация по IP приблизительная: обычно точна до города, а у мобильных и VPN может ошибаться.\n";
  }
  const d = p && p.data;
  if (d) { o += ln("Сеть", d.resource); const a = d.asns && d.asns[0]; if (a) o += ln("Владелец сети", a.holder); }
  if (!g && !d) o += "Данные не получены.\n";
  o += lnk([["Shodan", "https://www.shodan.io/host/" + ip], ["AbuseIPDB", "https://www.abuseipdb.com/check/" + ip], ["Censys", "https://search.censys.io/hosts/" + ip]]);
  return o;
}

/* ---- email ---- */
async function aEmail(e) {
  e = e.toLowerCase();
  const dom = e.split("@")[1];
  const [mx, grav] = await Promise.all([
    doh(dom, "MX"),
    (async () => { try { const h = await digest("SHA-256", new TextEncoder().encode(e)); const r = await fetch("https://gravatar.com/avatar/" + h + "?d=404", { method: "HEAD", headers: UA, signal: AbortSignal.timeout(6000) }); return r.status === 200 ? h : null; } catch (x) { return null; } })(),
  ]);
  let o = head("✉️", "Email " + e);
  o += ln("Домен", dom);
  o += ln("Почта у домена", mx.length ? "принимает (" + mx.length + " MX)" : "MX не найден: адрес, скорее всего, не существует");
  if (DISPOSABLE.test(dom)) o += "⚠️ Одноразовая почта\n";
  if (/^(gmail|googlemail)\.com$/.test(dom)) o += ln("Gmail", "точки и +метки в имени игнорируются");
  o += ln("Gravatar", grav ? "есть аватар, профиль: https://gravatar.com/" + grav : "нет");
  o += lnk([["Утечки: HIBP", "https://haveibeenpwned.com/account/" + encodeURIComponent(e)], ["Поиск адреса", "https://www.google.com/search?q=%22" + encodeURIComponent(e) + "%22"]]);
  return o;
}

/* ---- крипто ---- */
async function aCrypto(a) {
  const BS = "1-9A-HJ-NP-Za-km-z";
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) {
    const [b, c] = await Promise.all([jget("https://eth.blockscout.com/api/v2/addresses/" + a).catch(() => null), jget("https://eth.blockscout.com/api/v2/addresses/" + a + "/counters").catch(() => null)]);
    const eth = b && b.coin_balance ? Number(BigInt(b.coin_balance) / 10n ** 12n) / 1e6 : null;
    let o = head("🪙", "Ethereum-адрес");
    o += ln("Адрес", a); o += ln("Баланс", eth != null ? num(eth, 6) + " ETH" : "");
    o += ln("Тип", b ? (b.is_contract ? "смарт-контракт" : "обычный кошелёк") : "");
    o += ln("Транзакций", c && c.transactions_count); o += ln("Переводов токенов", c && c.token_transfers_count);
    return o + lnk([["Etherscan", "https://etherscan.io/address/" + a], ["Arkham", "https://intel.arkm.com/explorer/address/" + a]]);
  }
  if (new RegExp("^[13][" + BS + "]{25,34}$").test(a) || /^bc1[a-z0-9]{11,87}$/i.test(a)) {
    if (/^[13]/.test(a) && !(await b58check(a))) return head("🪙", "Bitcoin-адрес") + "⚠️ Контрольная сумма не сходится: опечатка или выдуманный адрес.\n";
    const [s, tx] = await Promise.all([jget("https://blockstream.info/api/address/" + a).catch(() => null), jget("https://blockstream.info/api/address/" + a + "/txs").catch(() => [])]);
    const cs = (s && s.chain_stats) || {};
    let o = head("🪙", "Bitcoin-адрес");
    o += ln("Адрес", a);
    if (s) { o += ln("Баланс", num(((cs.funded_txo_sum || 0) - (cs.spent_txo_sum || 0)) / 1e8, 8) + " BTC"); o += ln("Всего получено", num((cs.funded_txo_sum || 0) / 1e8, 8) + " BTC"); o += ln("Транзакций", cs.tx_count || 0); }
    const t0 = tx && tx.length && tx[tx.length - 1].status && tx[tx.length - 1].status.block_time;
    o += ln("Последняя активность", tx && tx[0] && tx[0].status && tx[0].status.block_time ? dt(tx[0].status.block_time * 1000) : "");
    return o + lnk([["Blockstream", "https://blockstream.info/address/" + a], ["Arkham", "https://intel.arkm.com/explorer/address/" + a]]);
  }
  if (new RegExp("^T[" + BS + "]{33}$").test(a)) {
    if (!(await b58check(a))) return head("🪙", "TRON-адрес") + "⚠️ Контрольная сумма не сходится: опечатка или выдуманный адрес.\n";
    const t = await jget("https://apilist.tronscanapi.com/api/accountv2?address=" + a).catch(() => null);
    let o = head("🪙", "TRON-адрес (USDT-TRC20 и другие)");
    o += ln("Адрес", a);
    if (t) { o += ln("Баланс TRX", t.balance != null ? num(t.balance / 1e6, 6) : ""); o += ln("Транзакций", t.totalTransactionCount); o += ln("Создан", t.date_created ? dt(t.date_created) : ""); }
    return o + lnk([["Tronscan", "https://tronscan.org/#/address/" + a], ["Arkham", "https://intel.arkm.com/explorer/address/" + a]]);
  }
  return "";
}

/* ---- координаты ---- */
async function aCoords(la, lo) {
  const u = toUTM(la, lo);
  let addr = "";
  try { const g = await jget("https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ru&zoom=18&lat=" + la + "&lon=" + lo, { headers: UA }); addr = g && g.display_name; } catch (e) {}
  let o = head("📍", "Координаты");
  o += ln("Точка", num(la, 6) + ", " + num(lo, 6));
  o += ln("Адрес", addr); o += ln("DMS", dmsF(la, "N", "S") + " " + dmsF(lo, "E", "W"));
  o += ln("UTM", u.zone + u.band + " " + u.x + " E " + u.y + " N"); o += ln("Plus Code", plusCode(la, lo));
  return o + lnk([["Google", "https://www.google.com/maps?q=" + la + "," + lo], ["Яндекс", "https://yandex.ru/maps/?pt=" + lo + "," + la + "&z=17"], ["OSM", "https://www.openstreetmap.org/?mlat=" + la + "&mlon=" + lo]]);
}

/* ---- MAC ---- */
async function aMac(m) {
  const h = m.replace(/[^0-9a-f]/gi, "").toLowerCase(), oui = h.slice(0, 6).match(/../g).join(":").toUpperCase();
  const local = !!(parseInt(h.slice(0, 2), 16) & 2);
  let vendor = "";
  try { const r = await fetch("https://api.macvendors.com/" + oui, { headers: UA, signal: AbortSignal.timeout(6000) }); if (r.ok) vendor = (await r.text()).trim(); } catch (e) {}
  let o = head("📶", "MAC-адрес");
  o += ln("OUI", oui); o += ln("Производитель", vendor || (local ? "не определить: адрес случайный" : "не найден"));
  if (local) o += "ℹ️ Случайный (локальный) адрес: так телефоны скрывают себя в Wi-Fi.\n";
  return o;
}

/* ---- хеш ---- */
function aHash(h) {
  const t = { 32: "MD5 (или NTLM)", 40: "SHA-1", 64: "SHA-256" }[h.length];
  return head("#️⃣", "Хеш " + t) + ln("Значение", h) + lnk([["VirusTotal", "https://www.virustotal.com/gui/file/" + h], ["MalwareBazaar", "https://bazaar.abuse.ch/browse.php?search=sha256%3A" + h]]) + "ℹ️ Сам хеш не раскрыть, но известные пароли и файлы ищутся по базам.\n";
}

/* ---- JWT ---- */
function aJwt(t) {
  const dec = (s) => { try { s = s.replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(decodeURIComponent(escape(atob(s + "=".repeat((4 - (s.length % 4)) % 4))))); } catch (e) { return null; } };
  const [h, p] = t.split(".");
  const hd = dec(h), pl = dec(p);
  if (!hd || !pl) return head("🔑", "JWT") + "Не удалось прочитать.\n";
  let o = head("🔑", "JWT-токен");
  o += ln("Алгоритм", hd.alg); o += ln("Издатель", pl.iss); o += ln("Субъект", pl.sub); o += ln("Аудитория", Array.isArray(pl.aud) ? pl.aud.join(", ") : pl.aud);
  if (pl.iat) o += ln("Выдан", dt(pl.iat * 1000));
  if (pl.exp) o += ln("Истекает", dt(pl.exp * 1000) + (pl.exp * 1000 < Date.now() ? " (просрочен)" : ""));
  if (String(hd.alg).toLowerCase() === "none") o += "⚠️ Алгоритм none: подпись не проверяется\n";
  o += "ℹ️ Подпись я не проверяю.\n";
  return o;
}

/* ---- телефон ---- */
const DIAL = [["998", "Узбекистан"], ["996", "Киргизия"], ["995", "Грузия"], ["994", "Азербайджан"], ["993", "Туркмения"], ["992", "Таджикистан"], ["380", "Украина"], ["375", "Беларусь"], ["374", "Армения"], ["373", "Молдова"], ["372", "Эстония"], ["371", "Латвия"], ["370", "Литва"], ["358", "Финляндия"], ["49", "Германия"], ["48", "Польша"], ["44", "Великобритания"], ["39", "Италия"], ["34", "Испания"], ["33", "Франция"], ["90", "Турция"], ["86", "Китай"], ["81", "Япония"], ["91", "Индия"], ["971", "ОАЭ"], ["972", "Израиль"], ["7", "Россия или Казахстан"], ["1", "США или Канада"]];
function aPhone(raw) {
  const d = raw.replace(/\D/g, "");
  let n = d;
  if (/^8\d{10}$/.test(d)) n = "7" + d.slice(1);
  const c = DIAL.find(([p]) => n.startsWith(p));
  let o = head("📞", "Телефон");
  o += ln("Номер", "+" + n); o += ln("Страна", c ? c[1] : "не определена");
  if (n.startsWith("7") && n.length === 11) o += ln("Код", n.slice(1, 4) + (/^[3489]/.test(n[1]) ? "" : " (мобильный или спец.)"));
  o += ln("Длина", n.length + (n.length >= 10 && n.length <= 15 ? " цифр, допустимо" : " цифр, необычно"));
  o += lnk([["WhatsApp", "https://wa.me/" + n], ["Telegram", "https://t.me/+" + n], ["Viber", "viber://chat?number=%2B" + n]]);
  return o;
}

/* ---- @юзернейм и ссылки Telegram ---- */
function aUser(u) {
  u = u.replace(/^@/, "");
  return head("✈️", "Юзернейм @" + u) + ln("Похож на бота", /bot$/i.test(u) ? "да" : "нет") + lnk([["t.me/" + u, "https://t.me/" + u], ["Лента канала", "https://t.me/s/" + u], ["Веб-версия", "https://web.telegram.org/k/#@" + u]]);
}
function aTgLink(raw) {
  let url;
  try { url = new URL(/^https?:/i.test(raw) ? raw : "https://" + raw); } catch (e) { return ""; }
  const seg = url.pathname.split("/").filter(Boolean), f = seg[0] || "";
  let o = head("✈️", "Ссылка Telegram");
  if (f === "joinchat" || f.startsWith("+")) o += ln("Тип", "приглашение в чат или канал") + ln("Код", f === "joinchat" ? seg[1] : f.slice(1));
  else if (f === "c") o += ln("Тип", "сообщение в закрытом канале") + ln("ID канала", "-100" + seg[1]) + ln("Сообщение", seg[2]);
  else if (f === "addstickers" || f === "addemoji") o += ln("Тип", "набор стикеров или эмодзи") + ln("Набор", seg[1]);
  else if (f) {
    o += ln("Тип", seg[1] && /^\d+$/.test(seg[1]) ? "пост в публичном канале или чате" : "профиль, канал, группа или бот") + ln("Юзернейм", "@" + f) + ln("Пост", /^\d+$/.test(seg[1] || "") ? seg[1] : "");
    o += ln("Бот", /bot$/i.test(f) ? "да" : "");
    for (const k of ["start", "startgroup", "startapp"]) {
      const x = url.searchParams.get(k); if (x == null) continue;
      o += ln(k, x);
      try { const t = atob(x.replace(/-/g, "+").replace(/_/g, "/")); if (/^[\x20-\x7E]{3,}$/.test(t)) o += ln("  расшифровка", t); } catch (e) {}
    }
  }
  return o;
}

/* ---- числа: IBAN, IMEI, карта, ИНН, ОГРН ---- */
async function aIban(s) {
  const cc = s.slice(0, 2), info = IBL[cc], ok = ibanOk(s);
  let o = head("🏦", "IBAN");
  o += ln("Страна", info ? info[1] + " (" + cc + ")" : cc); o += ln("Длина", s.length + (info ? " из " + info[0] : ""));
  o += ln("Контрольная сумма", ok ? "верна ✅" : "не сходится ❌");
  return o;
}
async function aNum(d) {
  let o = "";
  if (d.length === 15 && luhnOk(d)) o += head("📱", "IMEI") + ln("Контрольная цифра", "верна ✅") + ln("TAC (модель)", d.slice(0, 8)) + lnk([["Модель по TAC", "https://www.imei.info/?imei=" + d]]) + "\n";
  if (d.length >= 13 && d.length <= 19 && luhnOk(d) && !(d.length === 15 && /^\d{15}$/.test(d) && !/^3[47]/.test(d))) {
    o += head("💳", "Банковская карта") + ln("Платёжная система", cardBrand(d)) + ln("Проверка по Луну", "верна ✅");
    try {
      const j = await jget("https://lookup.binlist.net/" + d.slice(0, 8), { headers: { "Accept-Version": "3", ...UA } });
      o += ln("Банк", j.bank && j.bank.name) + ln("Страна", j.country && j.country.name) + ln("Тип", [j.type, j.brand].filter(Boolean).join(", "));
    } catch (e) {}
    o += "\n";
  }
  if ((d.length === 10 || d.length === 12) && innOk(d)) o += head("🧾", "ИНН") + ln("Тип", d.length === 10 ? "организация" : "ИП или физлицо") + ln("Контрольные цифры", "верны ✅") + ln("Регион", regTax(d.slice(0, 2))) + lnk([["ЕГРЮЛ/ЕГРИП", "https://egrul.nalog.ru/"], ["Проверка", "https://zachestnyibiznes.ru/search?query=" + d]]) + "\n";
  if ((d.length === 13 || d.length === 15) && ogrnOk(d)) o += head("🧾", d.length === 13 ? "ОГРН" : "ОГРНИП") + ln("Контрольная цифра", "верна ✅") + ln("Год внесения", "20" + d.slice(1, 3)) + ln("Регион", regTax(d.slice(3, 5))) + "\n";
  return o.trim() ? o : "";
}
function aPlate(p) {
  const m = p.match(/^([АВЕКМНОРСТУХ])(\d{3})([АВЕКМНОРСТУХ]{2})(\d{2,3})$/);
  if (!m) return "";
  return head("🚗", "Госномер " + p) + ln("Регион", regPlate(m[4]) || "код " + m[4] + " не найден") + ln("Код региона", m[4]);
}

/* ---- файл: метаданные и хеши ---- */
async function aFile(buf, name) {
  let o = head("📎", "Файл " + (name || ""));
  o += ln("Размер", buf.byteLength.toLocaleString("ru-RU") + " байт");
  let ex = null;
  try { ex = parseExif(buf); } catch (e) {}
  const A0 = (ex && ex.ifd0) || {}, E = (ex && ex.exif) || {}, G = (ex && ex.gps) || {};
  const one = (x) => (Array.isArray(x) ? x[0] : x);
  const has = Object.keys(A0).length || Object.keys(E).length;
  if (has) {
    o += "\n" + head("📷", "Метаданные");
    o += ln("Производитель", A0[0x010f]) + ln("Модель", A0[0x0110]) + ln("Объектив", E[0xa434]) + ln("Серийный номер", E[0xa431]) + ln("Программа", A0[0x0131]) + ln("Автор", A0[0x013b]);
    o += ln("Дата съёмки", E[0x9003]) + ln("Изменён", A0[0x0132]) + ln("Часовой пояс", E[0x9011]);
    if (typeof one(E[0x8827]) === "number") o += ln("ISO", one(E[0x8827]));
    if (G[2] && G[4]) {
      const dm = (a) => (Array.isArray(a) ? a[0] + (a[1] || 0) / 60 + (a[2] || 0) / 3600 : a);
      let la = dm(G[2]), lo = dm(G[4]);
      if (G[1] === "S") la = -la; if (G[3] === "W") lo = -lo;
      o += "\n" + (await aCoords(la, lo));
    } else o += "GPS: нет\n";
  } else o += "Метаданных нет (мессенджеры стирают их при отправке «как фото»).\n";
  if (buf.byteLength <= 20 * 1024 * 1024) {
    o += "\n" + head("#️⃣", "Хеши");
    o += ln("SHA-256", await digest("SHA-256", buf)) + ln("SHA-1", await digest("SHA-1", buf));
    try { o += ln("MD5", await digest("MD5", buf)); } catch (e) {}
  }
  return o;
}

/* ================= определение типа ================= */
const L2C = { A: "А", B: "В", E: "Е", K: "К", M: "М", H: "Н", O: "О", P: "Р", C: "С", T: "Т", Y: "У", X: "Х" };
const toCyr = (s) => [...s.toUpperCase()].map((c) => L2C[c] || c).join("");

/* вся строка целиком: возвращает [тип, значение] или null */
function classifyWhole(s) {
  s = s.trim();
  let m;
  if (/^(https?:\/\/)(t\.me|telegram\.me)\/\S+$/i.test(s) || /^(t\.me|telegram\.me)\/\S+$/i.test(s)) return ["tglink", s];
  if (/^https?:\/\/[^\s]+$/i.test(s)) return ["url", s];
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s)) return ["email", s];
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split(".").every((x) => +x <= 255)) return ["ip", s];
  if (/^[0-9a-f:]{3,39}$/i.test(s) && (s.match(/:/g) || []).length >= 2 && !/^([0-9a-f]{2}[:-]){5}/i.test(s)) return ["ip", s];
  if (/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(s)) return ["mac", s];
  if (/^(0x[0-9a-f]{40}|[13][1-9A-HJ-NP-Za-km-z]{25,34}|bc1[a-z0-9]{11,87}|T[1-9A-HJ-NP-Za-km-z]{33})$/i.test(s) && !/^[a-f0-9]{32,64}$/i.test(s)) return ["crypto", s];
  if ((m = s.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/)) && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180 && /\./.test(s)) return ["coords", [+m[1], +m[2]]];
  if (/^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(s)) return ["hash", s.toLowerCase()];
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(s)) return ["jwt", s];
  if (/^@[A-Za-z]\w{3,31}$/.test(s)) return ["user", s];
  const iban = s.replace(/\s/g, "").toUpperCase();
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban) && /^[A-Za-z]{2}\d{2}/.test(s.replace(/\s/g, "")) && IBL[iban.slice(0, 2)]) return ["iban", iban];
  const plate = toCyr(s.replace(/\s/g, ""));
  if (/^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/.test(plate)) return ["plate", plate];
  const dg = s.replace(/[\s()\-.]/g, "");
  if (/^\+?\d{6,19}$/.test(dg)) {
    const d = dg.replace(/\D/g, "");
    const isNum = (d.length === 15 && luhnOk(d)) || (d.length >= 13 && d.length <= 19 && luhnOk(d)) || ((d.length === 10 || d.length === 12) && innOk(d)) || ((d.length === 13 || d.length === 15) && ogrnOk(d));
    if (dg.startsWith("+") || (/^\d{10,11}$/.test(d) && !isNum)) return ["phone", d];
    if (isNum) return ["num", d];
    if (d.length >= 10 && d.length <= 15) return ["phone", d];
  }
  if (/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(s)) return ["domain", s.toLowerCase()];
  return null;
}

/* свободный текст: вытаскиваем всё, что похоже на объект */
function extract(text) {
  const out = [], seen = new Set();
  const add = (k, v) => { const key = k + "|" + (Array.isArray(v) ? v.join() : v); if (!seen.has(key)) { seen.add(key); out.push([k, v]); } };
  let t = text;
  for (const u of t.match(/(?:https?:\/\/|t\.me\/|telegram\.me\/)[^\s<>"'`)\]]+/gi) || []) { const x = u.replace(/[.,;:!?]+$/, ""); const w = classifyWhole(x); add(w ? w[0] : "url", /^https?:/i.test(x) || w && w[0] === "tglink" ? x : "https://" + x); }
  t = t.replace(/(?:https?:\/\/|t\.me\/|telegram\.me\/)[^\s<>"'`)\]]+/gi, " ");
  for (const e of t.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []) add("email", e);
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ");
  for (const ip of t.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || []) if (ip.split(".").every((x) => +x <= 255)) add("ip", ip);
  for (const c of t.match(/\b0x[0-9a-fA-F]{40}\b|\bbc1[a-z0-9]{20,87}\b|\b[13][1-9A-HJ-NP-Za-km-z]{25,34}\b|\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g) || []) add("crypto", c);
  for (const h of t.match(/\b(?:[a-f0-9]{64}|[a-f0-9]{40}|[a-f0-9]{32})\b/gi) || []) add("hash", h.toLowerCase());
  for (const u of t.match(/(?:^|[\s(])@[A-Za-z]\w{3,31}\b/g) || []) add("user", u.trim().replace(/^\(/, ""));
  for (const p of t.match(/\+\d[\d\s().-]{8,16}\d/g) || []) add("phone", p.replace(/\D/g, ""));
  for (const c of t.match(/-?\d{1,2}\.\d{3,}\s*[,;]\s*-?\d{1,3}\.\d{3,}/g) || []) { const w = classifyWhole(c); if (w) add("coords", w[1]); }
  for (const d of t.match(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|ru|io|info|biz|xyz|me|dev|app|ua|by|kz|de|uk|cn|su|рф|ru|co|tv|cc|site|online|top|pro|shop|store|link|click|live)\b/gi) || []) add("domain", d.toLowerCase());
  return out;
}

async function runOne([k, v]) {
  try {
    switch (k) {
      case "url": return await aUrl(v);
      case "tglink": return aTgLink(v);
      case "email": return await aEmail(v);
      case "ip": return await aIp(v);
      case "mac": return await aMac(v);
      case "crypto": return await aCrypto(v);
      case "coords": return await aCoords(v[0], v[1]);
      case "hash": return aHash(v);
      case "jwt": return aJwt(v);
      case "user": return aUser(v);
      case "iban": return await aIban(v);
      case "plate": return aPlate(v);
      case "phone": return aPhone(v);
      case "num": return await aNum(v);
      case "domain": return head("🌐", "Домен " + v) + (await aDomain(v)) + lnk([["Wayback", "https://web.archive.org/web/*/" + v], ["VirusTotal", "https://www.virustotal.com/gui/domain/" + v], ["Whois", "https://who.is/whois/" + v]]);
    }
  } catch (e) { return head("⚠️", "Ошибка проверки") + H(String((e && e.message) || e)) + "\n"; }
  return "";
}

/* главный вход: текст → готовое HTML-сообщение для Telegram или null, если нечего проверять */
export async function analyze(text) {
  text = String(text || "").trim();
  if (!text) return null;
  const w = classifyWhole(text);
  let items = w ? [w] : extract(text);
  if (!items.length) return null;
  const MAX = 3;
  const rest = items.slice(MAX);
  const parts = [];
  for (const it of items.slice(0, MAX)) { const r = await runOne(it); if (r && r.trim()) parts.push(r.trim()); }
  if (!parts.length) return null;
  let msg = parts.join("\n\n━━━━━━━━\n\n");
  if (rest.length) msg += "\n\nЕщё найдено, не проверял: " + H(rest.map(([k, v]) => (Array.isArray(v) ? v.join(",") : v)).slice(0, 8).join(", "));
  return trunc(msg);
}

export async function analyzeFile(buf, name) {
  const r = await aFile(buf, name);
  return trunc(r);
}
export const HELP = "Как пользоваться: ответь командой /check на любое сообщение со ссылкой, IP, доменом, email, ником, номером, крипто-адресом, координатами, хешем или файлом. Либо пиши /check и сразу то, что нужно проверить.";
