const path = require('node:path');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');

const baseUrl = '/mediacenter-demo';
const timezone = 'Asia/Makassar';
const defaultSettings = {
  about_title: 'Pusat informasi publik daerah',
  about_description: 'Media Center Kabupaten Hulu Sungai Tengah merupakan sarana penyampaian informasi pemerintah daerah kepada masyarakat.',
  portal_url: 'https://www.hstkab.go.id/',
};
const format = (date, opts) => {
  if (!date) return '-';
  const raw=String(date);
  const d = new Date(date instanceof Date ? date : /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00+08:00` : (/Z$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : raw.replace(' ', 'T')+'+08:00')); 
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', { timeZone: timezone, ...opts }).format(d);
};
const dateSql = value => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0,10);
  return String(value).slice(0,10);
};
const tanggalBerita = d => format(d, { day:'numeric', month:'long', year:'numeric' });
const tanggalAdmin = d => format(d, { day:'2-digit', month:'short', year:'numeric' });
const waktuAdmin = d => format(d, { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
const excerpt = (s,length=160) => String(s||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,length) + (String(s||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().length>length?'...':'');
const escapeHtml = s => String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nowTime = () => {
  const now=new Date();
  const tgl=new Intl.DateTimeFormat('id-ID',{timeZone:timezone,weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(now);
  const jam=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now).replace(/:/g,'.')+' WITA';
  return {tanggalFull:tgl,jamFull:jam};
};
const slugify = s => String(s||'').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'berita';
const detailUrl = slug => `${baseUrl}/detail?slug=${encodeURIComponent(slug)}`;
const kategoriUrl = kategori => `${baseUrl}/berita?kategori=${encodeURIComponent(kategori)}`;
const gambarUrl = name => {
  const normalized=String(name||'');
  const file=path.basename(normalized);
  if (!name || ![file,'berita/'+file].includes(normalized) || !/^[\w.-]+\.(jpg|jpeg|png|webp|avif)$/i.test(file)) return '';
  if (!fs.existsSync(path.join(__dirname,'../public/assets/img/berita',file))) return '';
  return `${baseUrl}/assets/img/berita/${encodeURIComponent(file)}`;
};
const numberFormat = n => new Intl.NumberFormat('id-ID').format(n||0);
const dayName = d => new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:timezone}).format(new Date(`${d}T12:00:00+08:00`));
const pageUrl = (page,q,kategori,tahun,urut) => {
  const params = new URLSearchParams();
  if(q)params.set('q',q);
  if(kategori)params.set('kategori',kategori);
  if(tahun)params.set('tahun',tahun);
  if(urut==='terlama')params.set('urut',urut);
  if(page>1)params.set('page',page);
  return `${baseUrl}/berita${params.size?'?'+params:''}`;
};
const placeholderHome='<div class="gov-home-placeholder"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 5h14l6 6v16H6z"/><path d="M20 5v7h6"/><path d="M11 17h10M11 21h7"/></svg></div>';
const placeholderNews=placeholderHome.replaceAll('gov-home','gov-news');
const placeholderDetail=placeholderHome.replaceAll('gov-home','gov-detail');
const sharedLocals = {baseUrl,timezone,dateSql,tanggalBerita,tanggalAdmin,waktuAdmin,excerpt,escapeHtml,detailUrl,kategoriUrl,gambarUrl,numberFormat,dayName,pageUrl,placeholderHome,placeholderNews,placeholderDetail};
module.exports={...sharedLocals,nowTime,slugify,defaultSettings};
