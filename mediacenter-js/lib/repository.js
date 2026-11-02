try { require('dotenv').config(); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const fs = require('node:fs');
const path = require('node:path');
const mysql = modeFromEnv => require('mysql2/promise');
const { defaultSettings } = require('./helpers');
const mode=(process.env.DB_MODE||'json').toLowerCase();
let pool;
const file=path.resolve(process.env.JSON_DB_FILE||path.join(__dirname,'../data/db.json'));
if(mode==='json')fs.mkdirSync(path.dirname(file),{recursive:true});
function jsonLoad(){
  if (!fs.existsSync(file)) return {berita:[],users:[],pengaturan:{}};
  const x=JSON.parse(fs.readFileSync(file,'utf8'));
  return {berita:x.berita||[],users:x.users||[],pengaturan:x.pengaturan||{}};
}
let state=mode==='json'?jsonLoad():null;
function save(){
  const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state,null,2));fs.renameSync(tmp,file);
}
if (mode==='mysql') {
  pool=mysql().createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'mediacenter_demo',connectionLimit:10,dateStrings:true,timezone:'+08:00',charset:'utf8mb4'});
} else if(mode!=='json') { throw new Error('DB_MODE harus json atau mysql'); }
async function rows(sql,p=[]){const [r]=await pool.execute(sql,p);return r;}
const normalize=x=>String(x||'').toLocaleLowerCase('id-ID');
function filterNews(items,filters={}){
  let list=items.filter(x => !filters.q || [x.judul,x.kategori,x.penulis].some(t=>normalize(t).includes(normalize(filters.q))));
  if(filters.kategori)list=list.filter(x=>x.kategori===filters.kategori);
  if(filters.tahun)list=list.filter(x=>String(x.tanggal).slice(0,4)===String(filters.tahun));
  return list.sort((a,b)=>{
    const order=String(a.tanggal).localeCompare(String(b.tanggal))||a.id-b.id;
    return filters.urut==='terlama'?order:-order;
  });
}
async function listNews(filters={}){
  const page=Math.max(1,Number(filters.page)||1), limit=Math.min(100,Math.max(1,Number(filters.limit)||9));
  if(mode==='json'){
    const found=filterNews(state.berita,filters),total=found.length;
    return {rows:found.slice((page-1)*limit,page*limit),total};
  }
  let sql=' FROM berita WHERE 1=1',params=[];
  if(filters.q){sql+=' AND (judul LIKE ? OR kategori LIKE ? OR penulis LIKE ?)';let pattern=`%${filters.q}%`;params.push(pattern,pattern,pattern);}
  if(filters.kategori){sql+=' AND kategori = ?';params.push(filters.kategori);}
  if(filters.tahun){sql+=' AND YEAR(tanggal) = ?';params.push(Number(filters.tahun));}
  const [{total}]=await rows('SELECT COUNT(*) AS total'+sql,params);
  const order=filters.urut==='terlama'?'ASC':'DESC';
  const found=await rows('SELECT id,judul,slug,isi,gambar,kategori,tanggal,penulis,sumber,updated_at'+sql+` ORDER BY tanggal ${order},id ${order} LIMIT ${limit} OFFSET ${(page-1)*limit}`,params);
  return {rows:found,total:Number(total)};
}
async function latestNews(limit=7){
  if(mode==='json')return filterNews(state.berita).slice(0,limit);
  return rows(`SELECT * FROM berita ORDER BY tanggal DESC,id DESC LIMIT ${Number(limit)||7}`);
}
async function getById(id){
  if(mode==='json')return state.berita.find(x=>x.id===Number(id))||null;
  const r=await rows('SELECT * FROM berita WHERE id=? LIMIT 1',[Number(id)]);return r[0]||null;
}
async function getBySlug(slug){
  if(mode==='json')return state.berita.find(x=>x.slug===slug)||null;
  const r=await rows('SELECT * FROM berita WHERE slug=? LIMIT 1',[slug]);return r[0]||null;
}
async function uniqueSlug(title,ignoreId=0){
  const {slugify}=require('./helpers'); const base=slugify(title);let slug=base,n=2;
  for(;;){
    const exists=mode==='json' ? state.berita.some(x=>x.slug===slug&&x.id!==Number(ignoreId)) : (await rows('SELECT id FROM berita WHERE slug=? AND id!=? LIMIT 1',[slug,ignoreId])).length>0;
    if(!exists)return slug;slug=base+'-'+n++;
  }
}
async function createNews(data){
  const slug=await uniqueSlug(data.judul);
  if(mode==='json'){
    const id=state.berita.reduce((m,r)=>Math.max(m,r.id),0)+1;const now=new Date().toISOString();
    state.berita.push({id,slug,...data,created_at:now,updated_at:now});save();return id;
  }
  const [r]=await pool.execute('INSERT INTO berita (judul,slug,isi,gambar,kategori,tanggal,penulis,sumber) VALUES (?,?,?,?,?,?,?,?)',[data.judul,slug,data.isi,data.gambar||null,data.kategori,data.tanggal,data.penulis,data.sumber]);return r.insertId;
}
async function updateNews(id,data){
  const slug=await uniqueSlug(data.judul,id);
  if(mode==='json'){
    const item=state.berita.find(x=>x.id===Number(id));if(!item)return false;
    Object.assign(item,data,{slug,updated_at:new Date().toISOString()});save();return true;
  }
  await rows('UPDATE berita SET judul=?,slug=?,isi=?,gambar=?,kategori=?,tanggal=?,penulis=?,sumber=? WHERE id=?',[data.judul,slug,data.isi,data.gambar||null,data.kategori,data.tanggal,data.penulis,data.sumber,id]);return true;
}
async function deleteNews(id){
  if(mode==='json'){
    const n=state.berita.length;state.berita=state.berita.filter(x=>x.id!==Number(id));save();return n!==state.berita.length;
  }
  await rows('DELETE FROM berita WHERE id=?',[Number(id)]);return true;
}
async function categories(){
  if(mode==='json')return [...new Set(state.berita.map(x=>x.kategori).filter(Boolean))].sort();
  return (await rows('SELECT DISTINCT kategori FROM berita WHERE kategori IS NOT NULL AND kategori != "" ORDER BY kategori')).map(r=>r.kategori);
}
async function years(){
  if(mode==='json')return [...new Set(state.berita.map(x=>Number(String(x.tanggal).slice(0,4))))].filter(Boolean).sort((a,b)=>b-a);
  return (await rows('SELECT DISTINCT YEAR(tanggal) AS y FROM berita ORDER BY y DESC')).map(r=>Number(r.y));
}
async function stats(){
  if(mode==='json'){
    const all=state.berita;
    return {totalBerita:all.length,totalKategori:new Set(all.map(x=>x.kategori).filter(Boolean)).size,totalGambar:all.filter(x=>x.gambar).length,latest:all.slice().sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))[0]?.updated_at||null};
  }
  const [s]=await rows("SELECT COUNT(*) AS totalBerita,COUNT(DISTINCT kategori) AS totalKategori,COUNT(NULLIF(gambar,'')) AS totalGambar,MAX(updated_at) AS latest FROM berita");return s;
}
async function activity(){
  const last=[];
  for(let i=6;i>=0;i--){let d=new Date();d.setUTCHours(12,0,0,0);d.setUTCDate(d.getUTCDate()-i);last.push({date:d.toISOString().slice(0,10),count:0});}
  const values=mode==='json'?state.berita.map(x=>({date:String(x.tanggal).slice(0,10)})):await rows('SELECT DATE_FORMAT(tanggal,"%Y-%m-%d") AS date FROM berita WHERE tanggal>=DATE_SUB(CURDATE(),INTERVAL 6 DAY)');
  for(const v of values){const item=last.find(x=>x.date===v.date);if(item)item.count++;}
  return last;
}
async function getSettings(){
  if(mode==='json')return {...defaultSettings,...state.pengaturan};
  const a=await rows('SELECT kunci,nilai FROM pengaturan');return {...defaultSettings,...Object.fromEntries(a.map(r=>[r.kunci,r.nilai]))};
}
async function saveSettings(fields){
  if(mode==='json'){state.pengaturan={...state.pengaturan,...fields};save();return;}
  for(const [k,v] of Object.entries(fields))await rows('INSERT INTO pengaturan(kunci,nilai) VALUES(?,?) ON DUPLICATE KEY UPDATE nilai=VALUES(nilai)',[k,v]);
}
async function getUser(username){
  if(mode==='json')return state.users.find(x=>x.username===username)||null;
  const a=await rows('SELECT id,username,password FROM users WHERE username=? LIMIT 1',[username]);return a[0]||null;
}
async function createUser(username,hash){
  if(mode==='json'){
    if(state.users.some(u=>u.username===username))throw new Error('Username sudah digunakan');
    const id=state.users.reduce((m,u)=>Math.max(m,u.id),0)+1;state.users.push({id,username,password:hash});save();return id;
  }
  const [a]=await pool.execute('INSERT INTO users(username,password) VALUES (?,?)',[username,hash]);return a.insertId;
}
module.exports={mode,listNews,latestNews,getById,getBySlug,uniqueSlug,createNews,updateNews,deleteNews,categories,years,stats,activity,getSettings,saveSettings,getUser,createUser};
