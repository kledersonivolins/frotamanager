/* ═══════════════════════════════════════════════════════════════
   FrotaManager — Módulo Troca de Óleo / Filtros (complemento)

   O que faz
   1) Na Ordem de Serviço: ao escolher o tipo de manutenção
      "Troca de Óleo" (ou qualquer tipo com óleo/filtro), aparece um
      painel com os itens (óleos e filtros) para informar referência e
      quantidade. As referências ficam gravadas por veículo e voltam
      preenchidas na próxima troca.
   2) Módulo "Troca de Óleo" (menu Manutenção): cadastro do tempo de
      troca (km/horas e dias) e quantidade de cada item, referências por
      veículo e painel de vencimentos.

   Como se pluga: só depende de globais já existentes no sistema
   (db, openModalOS, salvarOS, PAGE_FNS, PAGE_TITLES, MENU, SB_TABLES,
   _sb/_sbTenant). Tudo é verificado em tempo de execução; se algum
   item não existir, o módulo apenas ignora aquela parte.

   Tabelas (SQL em sql/troca_oleo.sql): troca_oleo_config, troca_oleo_veiculo
   ═══════════════════════════════════════════════════════════════ */
(function(){
'use strict';
if(window.__trocaOleoCarregado) return;
window.__trocaOleoCarregado = true;

const T_CFG = 'troca_oleo_config';
const T_VEI = 'troca_oleo_veiculo';

// Itens sugeridos — são apenas ponto de partida; o usuário ajusta no módulo.
const SUGERIDOS = [
  {nome:'Óleo do motor',               categoria:'oleo',   intervalo_hod:10000, intervalo_dias:180, quantidade_padrao:15, unidade:'L'},
  {nome:'Filtro de óleo do motor',     categoria:'filtro', intervalo_hod:10000, intervalo_dias:180, quantidade_padrao:1,  unidade:'un'},
  {nome:'Filtro de combustível',       categoria:'filtro', intervalo_hod:10000, intervalo_dias:180, quantidade_padrao:1,  unidade:'un'},
  {nome:'Filtro separador de água',    categoria:'filtro', intervalo_hod:10000, intervalo_dias:180, quantidade_padrao:1,  unidade:'un'},
  {nome:'Filtro de ar',                categoria:'filtro', intervalo_hod:20000, intervalo_dias:365, quantidade_padrao:1,  unidade:'un'},
  {nome:'Óleo da caixa de câmbio',     categoria:'oleo',   intervalo_hod:60000, intervalo_dias:730, quantidade_padrao:10, unidade:'L'},
  {nome:'Óleo do diferencial',         categoria:'oleo',   intervalo_hod:60000, intervalo_dias:730, quantidade_padrao:8,  unidade:'L'},
  {nome:'Óleo hidráulico',             categoria:'oleo',   intervalo_hod:0,     intervalo_dias:365, quantidade_padrao:20, unidade:'L'},
  {nome:'Filtro hidráulico',           categoria:'filtro', intervalo_hod:0,     intervalo_dias:365, quantidade_padrao:1,  unidade:'un'}
];

// ── Helpers de acesso às globais do sistema ─────────────────────
const DB   = () => (typeof db !== 'undefined' ? db : window.db);
const SB   = () => (typeof _sb !== 'undefined' ? _sb : window._sb);
const MODE = () => (typeof _sbMode !== 'undefined' ? _sbMode : 'local');
const TEN  = () => (typeof _sbTenant !== 'undefined' ? _sbTenant : undefined);
const toast = (m,t) => { try{ showToast(m,t||'info'); }catch(e){ console.log('[troca-oleo]',m); } };
const esc2 = v => (typeof esc === 'function' ? esc(v) : String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
const newId = () => (typeof uid === 'function' ? uid() : Date.now()+Math.floor(Math.random()*1000));
const hojeISO = () => new Date().toISOString().split('T')[0];
const fmtData = d => { if(!d) return '—'; const p=String(d).slice(0,10).split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:d; };
const num = v => { const n = parseFloat(String(v==null?'':v).replace(',','.')); return isNaN(n)?0:n; };

function tabelas(){
  const d = DB(); if(!d) return null;
  if(!d[T_CFG]) d[T_CFG] = [];
  if(!d[T_VEI]) d[T_VEI] = [];
  return d;
}
function configs(){ const d=tabelas(); return d ? d[T_CFG].filter(c=>c.ativo!==false).sort((a,b)=>(a.ordem||0)-(b.ordem||0)||String(a.nome).localeCompare(String(b.nome))) : []; }
function eqLista(){
  const d = DB(); if(!d) return [];
  if(typeof _eqsDaEmpresa === 'function'){ try{ return _eqsDaEmpresa(); }catch(e){} }
  return d.equipamentos || [];
}
function eqNome(id){
  if(typeof eqDesc === 'function') return eqDesc(id);
  const e = (DB().equipamentos||[]).find(x=>x.id==id); return e ? `${e.placa||''} — ${e.modelo||''}` : 'N/A';
}
function hodAtual(eqId){
  const d = DB();
  const e = (d.equipamentos||[]).find(x=>x.id==eqId);
  let v = 0;
  if(e){ for(const k of ['km_atual','hodometro_atual','hodometro','km','horimetro_atual','horimetro']){ if(num(e[k])>0){ v=num(e[k]); break; } } }
  const osMax = (d.ordens_servico||[]).filter(o=>o.equipamento_id==eqId && !o.excluido).reduce((m,o)=>Math.max(m,num(o.hodometro)),0);
  return Math.max(v, osMax);
}

// ── Persistência ────────────────────────────────────────────────
async function gravar(tabela, reg){
  try{
    if(MODE()==='supabase' && SB()){
      const { error } = await SB().from(tabela).upsert({ ...reg, tenant: TEN() }, { onConflict:'id' });
      if(error) throw error;
    }
    return true;
  }catch(err){
    console.error('[troca-oleo] erro ao gravar', tabela, err);
    toast('Erro ao salvar ['+tabela+']: '+(err.message||err),'danger');
    return false;
  }
}
function upsertLocal(tabela, reg){
  const arr = tabelas()[tabela];
  const i = arr.findIndex(x=>x.id==reg.id);
  if(i>=0) arr[i] = reg; else arr.push(reg);
}
async function salvarReg(tabela, reg){ upsertLocal(tabela, reg); return gravar(tabela, reg); }

function vinculo(eqId, cfgId){ return tabelas()[T_VEI].find(v=>v.equipamento_id==eqId && v.config_id==cfgId && v.ativo!==false); }

// ═══════════════════════════════════════════════════════════════
//  1) PAINEL DENTRO DA ORDEM DE SERVIÇO
// ═══════════════════════════════════════════════════════════════
function tmanuEhOleo(){
  const v = document.getElementById('os_tmanu')?.value || '';
  return /oleo|óleo|filtro/i.test(v);
}
function painelAtivo(){ return !!document.getElementById('os_oleo_painel') && tmanuEhOleo(); }

function linhasPainel(eqId){
  const cfg = configs();
  if(!cfg.length){
    return `<div style="padding:12px;font-size:12px;color:var(--text2)">
      Nenhum item cadastrado. Abra o módulo <b>Manutenção → Troca de Óleo</b> para cadastrar os itens e os intervalos
      ${typeof loadPage==='function' ? `<br><button type="button" class="btn btn-o btn-sm" style="margin-top:8px" onclick="trocaOleoCarregarSugeridos().then(()=>trocaOleoOSRender())">Carregar itens sugeridos</button>`:''}
    </div>`;
  }
  return cfg.map(c=>{
    const v = eqId ? vinculo(eqId, c.id) : null;
    const ref = v?.referencia || '';
    const qtd = (v && v.quantidade!=null && v.quantidade!=='') ? v.quantidade : (c.quantidade_padrao||'');
    const un  = v?.unidade || c.unidade || 'un';
    const ult = v?.ultima_troca_data ? `Última: ${fmtData(v.ultima_troca_data)}${num(v.ultimo_hod)?' · '+v.ultimo_hod:''}` : 'Sem troca registrada';
    return `<tr data-cfg="${c.id}">
      <td style="width:34px;text-align:center"><input type="checkbox" class="to-trocar"></td>
      <td><b>${esc2(c.nome)}</b><div style="font-size:10px;color:var(--text2)">${ult}</div></td>
      <td><input class="fi to-ref" placeholder="Referência / código" value="${esc2(ref)}"></td>
      <td style="width:80px"><input class="fi to-qtd" type="number" step="0.01" value="${esc2(qtd)}"></td>
      <td style="width:60px"><input class="fi to-un" value="${esc2(un)}"></td>
    </tr>`;
  }).join('');
}

window.trocaOleoOSRender = function(){
  const corpo = document.getElementById('os_oleo_corpo'); if(!corpo) return;
  const eq = document.getElementById('os_eq')?.value || '';
  corpo.innerHTML = linhasPainel(eq);
  const aviso = document.getElementById('os_oleo_aviso');
  if(aviso) aviso.style.display = eq ? 'none' : 'block';
};
window.trocaOleoMarcarTodos = function(chk){
  document.querySelectorAll('#os_oleo_corpo .to-trocar').forEach(c=>c.checked = chk);
};
function atualizarVisibilidade(){
  const p = document.getElementById('os_oleo_painel'); if(!p) return;
  p.style.display = tmanuEhOleo() ? 'block' : 'none';
}

function montarPainelOS(){
  const sel = document.getElementById('os_tmanu');
  if(!sel || document.getElementById('os_oleo_painel')) return;

  // Formulários mais antigos não têm a opção "Troca de Óleo" no tipo de manutenção
  if(![...sel.options].some(o=>/oleo|óleo/i.test(o.value+o.text))){
    const op = document.createElement('option');
    op.value = 'preventiva_troca_oleo'; op.textContent = '🛢️ Troca de Óleo';
    sel.appendChild(op);
  }

  const painel = document.createElement('div');
  painel.id = 'os_oleo_painel';
  painel.style.cssText = 'display:none;background:var(--bg);border:1.5px solid var(--primary);border-radius:10px;padding:12px;margin:10px 0';
  painel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:800;text-transform:uppercase"><i class="fas fa-oil-can"></i> Troca de óleo e filtros</div>
      <label style="font-size:12px;cursor:pointer"><input type="checkbox" onchange="trocaOleoMarcarTodos(this.checked)"> Marcar todos como trocados</label>
    </div>
    <div id="os_oleo_aviso" style="font-size:12px;color:var(--warning);margin-bottom:6px">Selecione o equipamento para carregar as referências gravadas.</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Trocar</th><th>Item</th><th>Referência</th><th>Qtd</th><th>Un</th></tr></thead>
      <tbody id="os_oleo_corpo"></tbody>
    </table></div>
    <div style="font-size:11px;color:var(--text2);margin-top:6px">
      As referências e quantidades informadas ficam gravadas para este veículo e voltam preenchidas na próxima troca.
      Os itens marcados como "Trocar" entram na lista de itens da OS e atualizam a data/hodômetro da última troca.
    </div>`;
  const ancora = sel.closest('.frow') || sel.parentElement;
  ancora.insertAdjacentElement('afterend', painel);

  ['os_tmanu','os_tp'].forEach(id=>{
    document.getElementById(id)?.addEventListener('change', ()=>setTimeout(atualizarVisibilidade,0));
  });
  document.getElementById('os_eq')?.addEventListener('change', window.trocaOleoOSRender);
  trocaOleoOSRender();
  atualizarVisibilidade();
}

function coletarPainel(){
  return [...document.querySelectorAll('#os_oleo_corpo tr[data-cfg]')].map(tr=>({
    cfgId: tr.dataset.cfg,
    trocar: tr.querySelector('.to-trocar').checked,
    referencia: tr.querySelector('.to-ref').value.trim(),
    quantidade: num(tr.querySelector('.to-qtd').value),
    unidade: tr.querySelector('.to-un').value.trim() || 'un'
  }));
}
function itensDaOS(linhas){
  return linhas.filter(l=>l.trocar).map(l=>{
    const c = tabelas()[T_CFG].find(x=>x.id==l.cfgId);
    return { id:newId(), tipo: c?.categoria==='filtro'?'filtro':'oleo', descricao: c?.nome||'Item', referencia:l.referencia,
             quantidade:l.quantidade||1, unidade:l.unidade, obs:'Troca de óleo/filtros', futura:false, origem:'troca_oleo' };
  });
}
async function registrarTrocas(os, linhas){
  const agora = new Date().toISOString();
  for(const l of linhas){
    if(!l.trocar && !l.referencia) continue;                 // nada a gravar
    const atual = vinculo(os.equipamento_id, l.cfgId);
    const reg = atual ? { ...atual } : { id:newId(), equipamento_id:os.equipamento_id, config_id:isNaN(l.cfgId)?l.cfgId:Number(l.cfgId), ativo:true };
    reg.referencia = l.referencia; reg.quantidade = l.quantidade; reg.unidade = l.unidade; reg.atualizado_em = agora;
    if(l.trocar){
      reg.ultima_troca_data = os.data_abertura || hojeISO();
      reg.ultimo_hod = num(os.hodometro) || null;
      reg.ultima_os_id = os.id; reg.ultima_os_numero = os.numero;
    }
    await salvarReg(T_VEI, reg);
  }
}

function plugarOS(){
  if(typeof window.openModalOS !== 'function' || typeof window.salvarOS !== 'function') return false;
  if(window.openModalOS.__troca) return true;

  const abrir = window.openModalOS;
  window.openModalOS = function(){
    const r = abrir.apply(this, arguments);
    try{ tabelas(); montarPainelOS(); }catch(e){ console.warn('[troca-oleo] painel OS', e); }
    return r;
  };
  window.openModalOS.__troca = true;

  if(typeof window._coletarItensOS === 'function'){
    const coletar = window._coletarItensOS;
    window._coletarItensOS = function(){
      const base = coletar.apply(this, arguments) || [];
      return window.__osOleoItens ? base.concat(window.__osOleoItens) : base;
    };
  }

  const salvar = window.salvarOS;
  window.salvarOS = function(){
    const d = tabelas();
    const ativo = painelAtivo();
    const linhas = ativo ? coletarPainel() : null;
    const antes = d.ordens_servico.length;
    window.__osOleoItens = linhas ? itensDaOS(linhas) : null;
    let r;
    try{ r = salvar.apply(this, arguments); } finally { var itens = window.__osOleoItens; window.__osOleoItens = null; }
    if(linhas && d.ordens_servico.length > antes){            // OS realmente criada
      const os = d.ordens_servico[d.ordens_servico.length-1];
      // Garante os itens na OS mesmo se o coletor de itens não foi interceptado
      if(itens && itens.length && !(os.itens||[]).some(i=>i.origem==='troca_oleo')){
        os.itens = (os.itens||[]).concat(itens);
        if(typeof sbSalvar === 'function') sbSalvar('ordens_servico', os);
      }
      registrarTrocas(os, linhas);
    }
    return r;
  };
  return true;
}

// ═══════════════════════════════════════════════════════════════
//  2) MÓDULO "TROCA DE ÓLEO"
// ═══════════════════════════════════════════════════════════════
window.trocaOleoCarregarSugeridos = async function(){
  tabelas();
  const nomes = new Set(configs().map(c=>c.nome.toLowerCase()));
  let n = 0;
  for(const [i,s] of SUGERIDOS.entries()){
    if(nomes.has(s.nome.toLowerCase())) continue;
    await salvarReg(T_CFG, { id:newId()+i, ...s, ativo:true, ordem:i+1 }); n++;
  }
  toast(n ? n+' itens sugeridos cadastrados — ajuste os intervalos conforme sua frota.' : 'Os itens sugeridos já estão cadastrados.', n?'success':'info');
};

function situacao(cfg, v, eqId){
  if(!v || !v.ultima_troca_data) return { cls:'bi', txt:'Sem registro', ord:3, prox:'—' };
  const partes = []; let pior = 0; // 0 ok, 1 atenção, 2 vencido
  const iH = num(cfg.intervalo_hod), iD = num(cfg.intervalo_dias);
  if(iH>0 && num(v.ultimo_hod)>0){
    const prox = num(v.ultimo_hod)+iH, falta = prox - hodAtual(eqId);
    partes.push(`${prox.toLocaleString('pt-BR')} (${falta<=0?'venceu há '+Math.abs(falta).toLocaleString('pt-BR'):'faltam '+falta.toLocaleString('pt-BR')})`);
    pior = Math.max(pior, falta<=0?2 : falta<=iH*0.1?1 : 0);
  }
  if(iD>0){
    const dt = new Date(v.ultima_troca_data+'T12:00:00'); dt.setDate(dt.getDate()+iD);
    const dias = Math.round((dt - new Date())/86400000);
    partes.push(`${fmtData(dt.toISOString().slice(0,10))} (${dias<=0?'venceu há '+Math.abs(dias)+' d':'faltam '+dias+' d'})`);
    pior = Math.max(pior, dias<=0?2 : dias<=15?1 : 0);
  }
  if(!partes.length) return { cls:'bi', txt:'Sem intervalo', ord:3, prox:'—' };
  return pior===2 ? { cls:'bd', txt:'Vencido', ord:0, prox:partes.join('<br>') }
       : pior===1 ? { cls:'bw', txt:'Próximo', ord:1, prox:partes.join('<br>') }
                  : { cls:'bs', txt:'Em dia',  ord:2, prox:partes.join('<br>') };
}

function abaPainel(){
  const d = tabelas(); const fEq = window._toEq||'', fSt = window._toSt||'';
  const cfgMap = Object.fromEntries(d[T_CFG].map(c=>[c.id,c]));
  let linhas = d[T_VEI].filter(v=>v.ativo!==false && cfgMap[v.config_id] && cfgMap[v.config_id].ativo!==false).map(v=>({ v, c:cfgMap[v.config_id], s:situacao(cfgMap[v.config_id], v, v.equipamento_id) }));
  if(fEq) linhas = linhas.filter(x=>x.v.equipamento_id==fEq);
  if(fSt) linhas = linhas.filter(x=>x.s.txt===fSt);
  linhas.sort((a,b)=>a.s.ord-b.s.ord || eqNome(a.v.equipamento_id).localeCompare(eqNome(b.v.equipamento_id)));
  const cont = t => d[T_VEI].filter(v=>v.ativo!==false && cfgMap[v.config_id] && situacao(cfgMap[v.config_id],v,v.equipamento_id).txt===t).length;
  const optsEq = eqLista().map(e=>`<option value="${e.id}" ${fEq==e.id?'selected':''}>${esc2(e.placa||'')} — ${esc2(e.modelo||'')}</option>`).join('');
  return `<div class="grid-stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat bd"><label>Vencidos</label><div class="val">${cont('Vencido')}</div></div>
      <div class="stat bw"><label>Próximos</label><div class="val">${cont('Próximo')}</div></div>
      <div class="stat bs"><label>Em dia</label><div class="val">${cont('Em dia')}</div></div>
      <div class="stat"><label>Sem registro</label><div class="val">${cont('Sem registro')}</div></div>
    </div>
    <div class="row10" style="flex-wrap:wrap;margin:12px 0">
      <select class="fs" style="width:220px" onchange="window._toEq=this.value;loadPage('troca_oleo')"><option value="">Todos os equipamentos</option>${optsEq}</select>
      <select class="fs" style="width:160px" onchange="window._toSt=this.value;loadPage('troca_oleo')">
        <option value="">Todas as situações</option>${['Vencido','Próximo','Em dia','Sem registro'].map(s=>`<option ${fSt===s?'selected':''}>${s}</option>`).join('')}</select>
    </div>
    <div class="card"><div class="tbl-wrap"><table>
      <thead><tr><th>Equipamento</th><th>Item</th><th>Referência</th><th>Qtd</th><th>Última troca</th><th>Próxima troca</th><th>Situação</th></tr></thead>
      <tbody>${linhas.length ? linhas.map(x=>`<tr>
        <td>${esc2(eqNome(x.v.equipamento_id))}</td><td><b>${esc2(x.c.nome)}</b></td><td>${esc2(x.v.referencia||'—')}</td>
        <td>${esc2(x.v.quantidade??'')} ${esc2(x.v.unidade||'')}</td>
        <td>${fmtData(x.v.ultima_troca_data)}${num(x.v.ultimo_hod)?'<br><small>'+x.v.ultimo_hod+'</small>':''}${x.v.ultima_os_numero?'<br><small>OS #'+esc2(x.v.ultima_os_numero)+'</small>':''}</td>
        <td style="font-size:12px">${x.s.prox}</td><td><span class="badge ${x.s.cls}">${x.s.txt}</span></td></tr>`).join('')
        : `<tr><td colspan="7"><div class="empty"><i class="fas fa-oil-can"></i><p>Nenhuma troca registrada. Faça uma OS de Troca de Óleo ou informe a última troca na aba "Por veículo".</p></div></td></tr>`}</tbody>
    </table></div></div>`;
}

function abaItens(){
  const lista = configs();
  return `<div class="flex-b" style="margin-bottom:12px">
      <div style="font-size:12px;color:var(--text2)">Defina o tempo de troca (km/horas e dias) e a quantidade padrão de cada item. Vale para todos os veículos.</div>
      <div class="row10">
        <button class="btn btn-o" onclick="trocaOleoCarregarSugeridos().then(()=>loadPage('troca_oleo'))"><i class="fas fa-magic"></i> Itens sugeridos</button>
        <button class="btn btn-p" onclick="trocaOleoModalItem()"><i class="fas fa-plus"></i> Novo item</button>
      </div>
    </div>
    <div class="card"><div class="tbl-wrap"><table>
      <thead><tr><th>Item</th><th>Categoria</th><th>Troca a cada (km/h)</th><th>Troca a cada (dias)</th><th>Qtd padrão</th><th style="text-align:center">Ações</th></tr></thead>
      <tbody>${lista.length ? lista.map(c=>`<tr>
        <td><b>${esc2(c.nome)}</b></td><td>${c.categoria==='filtro'?'Filtro':c.categoria==='oleo'?'Óleo':'Outro'}</td>
        <td>${num(c.intervalo_hod)?Number(c.intervalo_hod).toLocaleString('pt-BR'):'—'}</td><td>${num(c.intervalo_dias)||'—'}</td>
        <td>${esc2(c.quantidade_padrao??'')} ${esc2(c.unidade||'')}</td>
        <td style="text-align:center"><button class="ic-btn gr" onclick="trocaOleoModalItem('${c.id}')"><i class="fas fa-edit"></i></button>
        <button class="ic-btn rd" onclick="trocaOleoExcluirItem('${c.id}')"><i class="fas fa-trash"></i></button></td></tr>`).join('')
        : `<tr><td colspan="6"><div class="empty"><i class="fas fa-oil-can"></i><p>Nenhum item cadastrado. Use "Itens sugeridos" ou "Novo item".</p></div></td></tr>`}</tbody>
    </table></div></div>`;
}

function abaVeiculo(){
  const eqId = window._toEqVei || '';
  const optsEq = eqLista().map(e=>`<option value="${e.id}" ${eqId==e.id?'selected':''}>${esc2(e.placa||'')} — ${esc2(e.modelo||'')}</option>`).join('');
  const cfg = configs();
  const corpo = !eqId ? `<div class="empty"><i class="fas fa-truck"></i><p>Selecione um equipamento.</p></div>` : `
    <div class="tbl-wrap"><table>
      <thead><tr><th>Item</th><th>Referência</th><th>Qtd</th><th>Un</th><th>Última troca</th><th>Hod/Hor. na troca</th></tr></thead>
      <tbody id="to_vei_corpo">${cfg.map(c=>{ const v=vinculo(eqId,c.id)||{};
        return `<tr data-cfg="${c.id}"><td><b>${esc2(c.nome)}</b></td>
          <td><input class="fi tv-ref" value="${esc2(v.referencia||'')}"></td>
          <td style="width:90px"><input class="fi tv-qtd" type="number" step="0.01" value="${esc2(v.quantidade ?? c.quantidade_padrao ?? '')}"></td>
          <td style="width:70px"><input class="fi tv-un" value="${esc2(v.unidade||c.unidade||'un')}"></td>
          <td style="width:150px"><input class="fi tv-dt" type="date" value="${esc2(v.ultima_troca_data||'')}"></td>
          <td style="width:130px"><input class="fi tv-hod" type="number" value="${esc2(v.ultimo_hod||'')}"></td></tr>`; }).join('')}</tbody>
    </table></div>
    <div style="margin-top:12px;text-align:right"><button class="btn btn-p" onclick="trocaOleoSalvarVeiculo()"><i class="fas fa-save"></i> Salvar referências</button></div>`;
  return `<div class="row10" style="margin-bottom:12px"><select class="fs" style="width:280px" onchange="window._toEqVei=this.value;loadPage('troca_oleo')">
      <option value="">Selecione o equipamento...</option>${optsEq}</select></div><div class="card">${corpo}</div>`;
}

function renderTrocaOleo(){
  tabelas();
  const aba = window._toAba || 'painel';
  const tab = (k,ic,t)=>`<button class="tab ${aba===k?'active':''}" onclick="window._toAba='${k}';loadPage('troca_oleo')"><i class="fas ${ic}"></i> ${t}</button>`;
  return `<div class="tabs">${tab('painel','fa-tachometer-alt','Painel de trocas')}${tab('itens','fa-list','Itens e intervalos')}${tab('veiculo','fa-truck','Por veículo')}</div>
    <div style="margin-top:14px">${aba==='itens'?abaItens():aba==='veiculo'?abaVeiculo():abaPainel()}</div>`;
}

window.trocaOleoModalItem = function(id){
  const c = id ? tabelas()[T_CFG].find(x=>x.id==id) : null;
  openModal(`<i class="fas fa-oil-can"></i> ${c?'Editar':'Novo'} item de troca`,`
    <div class="fg"><label>Nome do item *</label><input class="fi" id="toi_nome" value="${esc2(c?.nome||'')}" placeholder="Ex: Filtro de ar primário"></div>
    <div class="frow">
      <div class="fg"><label>Categoria</label><select class="fs" id="toi_cat">
        ${[['oleo','Óleo'],['filtro','Filtro'],['outro','Outro']].map(([v,t])=>`<option value="${v}" ${(c?.categoria||'oleo')===v?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="fg"><label>Quantidade padrão</label><input class="fi" type="number" step="0.01" id="toi_qtd" value="${esc2(c?.quantidade_padrao??'')}"></div>
      <div class="fg"><label>Unidade</label><input class="fi" id="toi_un" value="${esc2(c?.unidade||'L')}"></div>
    </div>
    <div class="frow">
      <div class="fg"><label>Trocar a cada (km ou horas)</label><input class="fi" type="number" id="toi_hod" value="${esc2(c?.intervalo_hod||'')}" placeholder="Ex: 10000"></div>
      <div class="fg"><label>Trocar a cada (dias)</label><input class="fi" type="number" id="toi_dias" value="${esc2(c?.intervalo_dias||'')}" placeholder="Ex: 180"></div>
    </div>
    <div style="font-size:11px;color:var(--text2)">Informe um ou os dois intervalos; vale o que vencer primeiro. Use km para veículos e horas para máquinas.</div>
    <div class="mf"><button class="btn btn-o" onclick="closeModal()">Cancelar</button><button class="btn btn-p" onclick="trocaOleoSalvarItem(${c?`'${c.id}'`:'null'})"><i class="fas fa-save"></i> Salvar</button></div>`,'md');
};
window.trocaOleoSalvarItem = async function(id){
  const nome = document.getElementById('toi_nome').value.trim();
  if(!nome){ toast('Informe o nome do item','warning'); return; }
  const base = id ? tabelas()[T_CFG].find(x=>x.id==id) : { id:newId(), ativo:true, ordem:tabelas()[T_CFG].length+1 };
  const reg = { ...base, nome, categoria:document.getElementById('toi_cat').value,
    quantidade_padrao: num(document.getElementById('toi_qtd').value) || null, unidade: document.getElementById('toi_un').value.trim() || 'un',
    intervalo_hod: num(document.getElementById('toi_hod').value) || null, intervalo_dias: parseInt(document.getElementById('toi_dias').value) || null };
  if(await salvarReg(T_CFG, reg)){ closeModal(); loadPage('troca_oleo'); toast('Item salvo','success'); }
};
window.trocaOleoExcluirItem = async function(id){
  if(!confirm('Excluir este item? As referências já gravadas nos veículos deixam de aparecer.')) return;
  const c = tabelas()[T_CFG].find(x=>x.id==id); if(!c) return;
  await salvarReg(T_CFG, { ...c, ativo:false });
  loadPage('troca_oleo');
};
window.trocaOleoSalvarVeiculo = async function(){
  const eqId = window._toEqVei; if(!eqId) return;
  let n = 0;
  for(const tr of document.querySelectorAll('#to_vei_corpo tr[data-cfg]')){
    const cfgId = tr.dataset.cfg, ref = tr.querySelector('.tv-ref').value.trim(), dt = tr.querySelector('.tv-dt').value;
    const atual = vinculo(eqId, cfgId);
    if(!atual && !ref && !dt) continue;
    const reg = atual ? { ...atual } : { id:newId()+n, equipamento_id:Number(eqId), config_id:isNaN(cfgId)?cfgId:Number(cfgId), ativo:true };
    Object.assign(reg, { referencia:ref, quantidade:num(tr.querySelector('.tv-qtd').value)||null, unidade:tr.querySelector('.tv-un').value.trim()||'un',
      ultima_troca_data: dt||null, ultimo_hod: num(tr.querySelector('.tv-hod').value)||null, atualizado_em:new Date().toISOString() });
    await salvarReg(T_VEI, reg); n++;
  }
  toast(n+' registro(s) salvo(s)','success'); loadPage('troca_oleo');
};

// ═══════════════════════════════════════════════════════════════
//  REGISTRO NO SISTEMA (tabelas, menu, página)
// ═══════════════════════════════════════════════════════════════
function registrarNoSistema(){
  let ok = true;
  try{ if(typeof SB_TABLES!=='undefined'){ [T_CFG,T_VEI].forEach(t=>{ if(!SB_TABLES.includes(t)) SB_TABLES.push(t); }); } }catch(e){}
  try{ tabelas(); }catch(e){}
  try{
    if(typeof PAGE_FNS!=='undefined'){ PAGE_FNS.troca_oleo = renderTrocaOleo; } else ok = false;
    if(typeof PAGE_TITLES!=='undefined'){ PAGE_TITLES.troca_oleo = 'Troca de Óleo e Filtros'; }
    if(typeof MENU!=='undefined'){
      const sec = MENU.find(s=>s.section==='Manutenção');
      if(sec && !sec.items.some(i=>i.page==='troca_oleo')){
        const i = sec.items.findIndex(x=>x.page==='planos');
        sec.items.splice(i>=0?i+1:sec.items.length, 0, { page:'troca_oleo', icon:'fa-oil-can', label:'Troca de Óleo', min:'operador' });
      }
    } else ok = false;
  }catch(e){ ok = false; console.warn('[troca-oleo] registro', e); }
  return ok;
}

// As funções do sistema podem ser definidas depois deste arquivo: tenta até conseguir.
let tentativas = 0;
(function iniciar(){
  const a = registrarNoSistema(), b = plugarOS();
  if((!a || !b) && ++tentativas < 40) return setTimeout(iniciar, 250);
  if(!a || !b) console.warn('[troca-oleo] parte do módulo não pôde ser ligada (registro:'+a+', OS:'+b+')');
})();

window.__trocaOleo = { renderTrocaOleo, situacao, coletarPainel, itensDaOS };
})();
