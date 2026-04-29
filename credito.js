/**
 * ═══════════════════════════════════════════════════════════════
 * RAPI10 CREDIT ENGINE  — v1.0
 * Módulo compartilhado entre cardapio.html e admin.html
 * Armazenamento: localStorage (pronto para migração ao Supabase)
 * ═══════════════════════════════════════════════════════════════
 */

/* ──────────────────────────────────────────────────────────────
   STORAGE KEYS
────────────────────────────────────────────────────────────── */
var CR_KEYS = {
  users:    'users_db',
  orders:   'orders',
  config:   'store_config',
  txns:     'credit_txns',      // transações de crédito
  wallets:  'credit_wallets',   // carteiras individuais
};

/* ──────────────────────────────────────────────────────────────
   SCORE TABLE
   Usado para calcular score do cliente (0-100)
────────────────────────────────────────────────────────────── */
var SCORE_WEIGHTS = {
  paidOnTime:  +10,
  paidLate:    -15,
  paidOverdue: -25,
  purchase:    +3,
  maxScore:    100,
  minScore:    0,
};

/* ──────────────────────────────────────────────────────────────
   STATUS LABELS
────────────────────────────────────────────────────────────── */
var CR_STATUS = {
  good:       { label: 'Bom pagador',    color: '#22c55e', emoji: '✅' },
  watch:      { label: 'Em observação',  color: '#f59e0b', emoji: '⚠️' },
  blocked:    { label: 'Bloqueado',      color: '#ef4444', emoji: '🚫' },
  inactive:   { label: 'Sem crédito',   color: '#7c8098', emoji: '🔒' },
};

/* ──────────────────────────────────────────────────────────────
   RANK TABLE (Bronze / Prata / Ouro + limites padrão)
────────────────────────────────────────────────────────────── */
var CR_RANKS = {
  bronze: { label: 'Bronze', emoji: '🥉', color: '#c07840', defaultLimit: 20 },
  silver: { label: 'Prata',  emoji: '🥈', color: '#94a3b8', defaultLimit: 40 },
  gold:   { label: 'Ouro',   emoji: '🥇', color: '#f5c842', defaultLimit: 60 },
};

/* ═══════════════════════════════════════════════════════════════
   DATA ACCESS LAYER
   Centraliza leitura/escrita — substitua por fetch() p/ Supabase
═══════════════════════════════════════════════════════════════ */
var CreditDB = {

  /* ── Password hashing (SHA-256 via SubtleCrypto, async) ── */
  hashPwd: function(plain) {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain))
        .then(function(buf) {
          return Array.from(new Uint8Array(buf))
            .map(function(b) { return b.toString(16).padStart(2,'0'); })
            .join('');
        });
    }
    // Fallback (non-secure, same-origin environments without subtle)
    return Promise.resolve('BTOA:' + btoa(plain));
  },

  /* ── Verifies plain password against stored hash ── */
  verifyPwd: function(plain, stored) {
    if (!stored) return Promise.resolve(false);
    // Legacy btoa support
    if (stored === btoa(plain)) return Promise.resolve(true);
    if (stored.startsWith('BTOA:')) return Promise.resolve(stored === 'BTOA:' + btoa(plain));
    return CreditDB.hashPwd(plain).then(function(h) { return h === stored; });
  },

  getUsers: function() {
    try { return JSON.parse(localStorage.getItem(CR_KEYS.users) || '[]'); }
    catch(e) { return []; }
  },

  saveUsers: function(users) {
    localStorage.setItem(CR_KEYS.users, JSON.stringify(users));
  },

  getUser: function(id) {
    return CreditDB.getUsers().find(function(u) { return u.id === id; }) || null;
  },

  updateUser: function(id, patch) {
    var users = CreditDB.getUsers();
    var idx = users.findIndex(function(u) { return u.id === id; });
    if (idx === -1) return false;
    users[idx] = Object.assign({}, users[idx], patch);
    CreditDB.saveUsers(users);
    return users[idx];
  },

  getOrders: function() {
    try { return JSON.parse(localStorage.getItem(CR_KEYS.orders) || '[]'); }
    catch(e) { return []; }
  },

  getUserOrders: function(email) {
    return CreditDB.getOrders().filter(function(o) { return o.customerEmail === email; });
  },

  getConfig: function() {
    try {
      var c = JSON.parse(localStorage.getItem(CR_KEYS.config) || '{}');
      return Object.assign({
        creditMinOrders: 5,
        creditLevels:   [20, 40, 60],
        creditTax:      5,
        creditDays:     30,
        autoBlock:      true,
        autoUpgrade:    true,
      }, c);
    } catch(e) { return {}; }
  },

  /* ── TRANSACTIONS ── */
  getTxns: function() {
    try { return JSON.parse(localStorage.getItem(CR_KEYS.txns) || '[]'); }
    catch(e) { return []; }
  },

  saveTxns: function(txns) {
    localStorage.setItem(CR_KEYS.txns, JSON.stringify(txns));
  },

  getUserTxns: function(userId) {
    return CreditDB.getTxns().filter(function(t) { return t.userId === userId; })
      .sort(function(a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  },

  addTxn: function(txn) {
    var txns = CreditDB.getTxns();
    var rand = Math.random().toString(36).slice(2, 7).toUpperCase();
    var newTxn = Object.assign({
      id:        'TX' + Date.now() + rand,
      createdAt: new Date().toISOString(),
    }, txn);
    txns.unshift(newTxn);
    CreditDB.saveTxns(txns);
    return newTxn;
  },
};

/* ═══════════════════════════════════════════════════════════════
   CREDIT ENGINE
   Regras de negócio isoladas
═══════════════════════════════════════════════════════════════ */
var CreditEngine = {

  /* ── Calcula limite dinâmico para o usuário ── */
  calcLimit: function(user) {
    // Admin pode sobrescrever manualmente
    if (typeof user.creditLimitOverride === 'number') return user.creditLimitOverride;

    var cfg    = CreditDB.getConfig();
    var orders = CreditDB.getUserOrders(user.email || '');
    var paid   = orders.filter(function(o) { return o.status === 'delivered'; });
    var n      = paid.length;
    var min    = cfg.creditMinOrders || 5;

    if (n < min) return 0;

    var levels = cfg.creditLevels || [20, 40, 60];
    var extra  = n - min;
    if (extra < 2)  return levels[0] || 20;
    if (extra < 6)  return levels[1] || 40;
    return levels[2] || 60;
  },

  /* ── Rank textual ── */
  getRank: function(user) {
    var limit = CreditEngine.calcLimit(user);
    if (limit <= 0) return null;
    var cfg = CreditDB.getConfig();
    var lv  = cfg.creditLevels || [20, 40, 60];
    if (limit <= lv[0]) return 'bronze';
    if (limit <= lv[1]) return 'silver';
    return 'gold';
  },

  /* ── Saldo devedor (crédito usado) ── */
  getDebt: function(user) {
    return user.creditUsed || 0;
  },

  /* ── Disponível para uso ── */
  getAvailable: function(user) {
    var limit = CreditEngine.calcLimit(user);
    var debt  = CreditEngine.getDebt(user);
    return Math.max(0, limit - debt);
  },

  /* ── Score (0-100) — contribuição por tipo é limitada ── */
  calcScore: function(user) {
    var txns  = CreditDB.getUserTxns(user.id);
    var score = 50; // base

    // Conta contribuições por tipo (evita inflate por volume)
    var counts = { paidOnTime: 0, paidLate: 0, paidOverdue: 0, purchase: 0 };
    txns.forEach(function(t) {
      if (t.type === 'payment_on_time') counts.paidOnTime++;
      if (t.type === 'payment_late')    counts.paidLate++;
      if (t.type === 'payment_overdue') counts.paidOverdue++;
      if (t.type === 'purchase')        counts.purchase++;
    });

    // Caps: pagamentos contam até 5x, compras até 10x
    score += Math.min(counts.paidOnTime,  5)  * SCORE_WEIGHTS.paidOnTime;
    score += Math.min(counts.paidLate,    5)  * SCORE_WEIGHTS.paidLate;
    score += Math.min(counts.paidOverdue, 5)  * SCORE_WEIGHTS.paidOverdue;
    score += Math.min(counts.purchase,    10) * SCORE_WEIGHTS.purchase;

    return Math.max(SCORE_WEIGHTS.minScore, Math.min(SCORE_WEIGHTS.maxScore, score));
  },

  /* ── Status do cliente ── */
  getStatus: function(user) {
    if (user.creditBlocked) return 'blocked';
    var limit = CreditEngine.calcLimit(user);
    if (limit <= 0)         return 'inactive';
    var score = CreditEngine.calcScore(user);
    if (score >= 60)        return 'good';
    if (score >= 35)        return 'watch';
    return 'blocked';
  },

  /* ── Dias até vencimento ── */
  getDaysLeft: function(user) {
    if (!user.creditDueDate) return null;
    return Math.ceil((new Date(user.creditDueDate) - Date.now()) / (1000 * 60 * 60 * 24));
  },

  /* ── Verifica se pode usar crédito ── */
  canUseCredit: function(user, amount) {
    var status = CreditEngine.getStatus(user);
    if (status === 'blocked' || status === 'inactive') return { ok: false, reason: 'Crédito bloqueado' };
    var avail = CreditEngine.getAvailable(user);
    if (amount > avail) return { ok: false, reason: 'Limite insuficiente (disponível: R$ ' + avail.toFixed(2).replace('.', ',') + ')' };
    return { ok: true };
  },

  /* ── Aplica compra no crédito ── */
  applyPurchase: function(userId, amount, orderId, description) {
    var users = CreditDB.getUsers();
    var idx   = users.findIndex(function(u) { return u.id === userId; });
    if (idx === -1) return false;

    var user = users[idx];
    var cfg  = CreditDB.getConfig();

    // Atualiza dívida
    users[idx].creditUsed = (user.creditUsed || 0) + amount;

    // Define vencimento se ainda não existe
    if (!users[idx].creditDueDate) {
      var days = cfg.creditDays || 30;
      users[idx].creditDueDate = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
    }

    CreditDB.saveUsers(users);

    // Registra transação
    CreditDB.addTxn({
      userId:      userId,
      type:        'purchase',
      amount:      -amount,
      balance:     CreditEngine.getAvailable(users[idx]),
      description: description || ('Compra #' + (orderId || '')),
      orderId:     orderId || '',
      status:      'confirmed',
    });

    return true;
  },

  /* ── Registra pagamento ── */
  applyPayment: function(userId, amount, description, adminNote) {
    var users = CreditDB.getUsers();
    var idx   = users.findIndex(function(u) { return u.id === userId; });
    if (idx === -1) return false;

    var user     = users[idx];
    var debt     = user.creditUsed || 0;
    var daysLeft = CreditEngine.getDaysLeft(user);
    var isLate   = daysLeft !== null && daysLeft < 0;

    // Reduz dívida
    users[idx].creditUsed = Math.max(0, debt - amount);

    // Se quitou tudo, limpa vencimento e desbloqueia se estava bloqueado por atraso
    if (users[idx].creditUsed <= 0) {
      users[idx].creditUsed    = 0;
      users[idx].creditDueDate = null;
      if (users[idx].creditAutoBlocked) {
        users[idx].creditBlocked      = false;
        users[idx].creditAutoBlocked  = false;
      }
    }

    CreditDB.saveUsers(users);

    // Tipo de transação (impacta score)
    var txnType = isLate ? 'payment_overdue' : (daysLeft !== null && daysLeft < 3 ? 'payment_late' : 'payment_on_time');

    CreditDB.addTxn({
      userId:      userId,
      type:        txnType,
      amount:      +amount,
      balance:     CreditEngine.getAvailable(users[idx]),
      description: description || 'Pagamento registrado',
      adminNote:   adminNote || '',
      status:      'confirmed',
    });

    // Verifica se cliente merece upgrade após pagamento em dia
    if (txnType === 'payment_on_time') {
      setTimeout(function() { CreditEngine.runAutoUpgrade(); }, 0);
    }

    return true;
  },

  /* ── Adiciona dívida manual (admin) ── */
  applyManualDebt: function(userId, amount, description) {
    return CreditEngine.applyPurchase(userId, amount, null, description || 'Débito manual');
  },

  /* ── Atualiza limite (admin) ── */
  setLimit: function(userId, newLimit) {
    var updated = CreditDB.updateUser(userId, { creditLimitOverride: newLimit });
    if (!updated) return false;
    CreditDB.addTxn({
      userId:      userId,
      type:        'limit_change',
      amount:      0,
      balance:     CreditEngine.getAvailable(updated),
      description: 'Limite alterado para R$ ' + newLimit.toFixed(2).replace('.', ','),
      status:      'confirmed',
    });
    return true;
  },

  /* ── Bloquear / Liberar ── */
  blockUser: function(userId, reason) {
    return CreditDB.updateUser(userId, { creditBlocked: true, creditBlockReason: reason || 'Bloqueado pelo admin' });
  },

  unblockUser: function(userId) {
    return CreditDB.updateUser(userId, { creditBlocked: false, creditBlockReason: null, creditAutoBlocked: false });
  },

  /* ── Auto-block: roda no máx 1x/hora para não degradar performance ── */
  runAutoRules: function() {
    var cfg = CreditDB.getConfig();
    if (!cfg.autoBlock) return;

    // Throttle: roda no máximo 1x por hora
    var THROTTLE_KEY = '_cr_autorules_ts';
    var last = parseInt(localStorage.getItem(THROTTLE_KEY) || '0');
    var now  = Date.now();
    if (now - last < 3600000) return; // 1h
    localStorage.setItem(THROTTLE_KEY, String(now));

    var users   = CreditDB.getUsers();
    var changed = false;

    users.forEach(function(u) {
      var debt     = u.creditUsed || 0;
      if (debt <= 0) return;

      var daysLeft = CreditEngine.getDaysLeft(u);
      if (daysLeft === null) return;

      // Bloquear automaticamente se vencido
      if (daysLeft < 0 && !u.creditBlocked) {
        u.creditBlocked      = true;
        u.creditAutoBlocked  = true;
        u.creditBlockReason  = 'Bloqueio automático por inadimplência';
        changed = true;

        CreditDB.addTxn({
          userId:      u.id,
          type:        'auto_block',
          amount:      0,
          balance:     0,
          description: 'Conta bloqueada automaticamente — vencimento ultrapassado',
          status:      'system',
        });
      }
    });

    if (changed) CreditDB.saveUsers(users);
  },

  /* ── Auto-upgrade: promove limite após pagamentos consecutivos em dia ── */
  runAutoUpgrade: function() {
    var cfg = CreditDB.getConfig();
    if (!cfg.autoUpgrade) return;

    var users   = CreditDB.getUsers();
    var levels  = cfg.creditLevels || [20, 40, 60];
    var changed = false;

    users.forEach(function(u) {
      var currentLimit = CreditEngine.calcLimit(u);
      if (currentLimit <= 0) return; // sem crédito ativo

      // Precisa ter 2+ pagamentos em dia consecutivos para upgrade
      var txns     = CreditDB.getUserTxns(u.id);
      var lastN    = txns.slice(0, 5); // últimas 5 transações
      var onTimeN  = lastN.filter(function(t) { return t.type === 'payment_on_time'; }).length;
      if (onTimeN < 2) return;

      // Calcula próximo nível
      var nextLimit = null;
      if (currentLimit < levels[0])      nextLimit = levels[0];
      else if (currentLimit < levels[1]) nextLimit = levels[1];
      else if (currentLimit < levels[2]) nextLimit = levels[2];
      if (!nextLimit || nextLimit <= currentLimit) return;

      // Verifica se já tem override — respeita se admin setou manualmente
      if (typeof u.creditLimitOverride === 'number' && u.creditLimitOverride >= nextLimit) return;

      // Aplica upgrade
      CreditDB.updateUser(u.id, { creditLimitOverride: nextLimit });
      CreditDB.addTxn({
        userId:      u.id,
        type:        'limit_change',
        amount:      nextLimit - currentLimit,
        balance:     Math.max(0, nextLimit - (u.creditUsed || 0)),
        description: 'Upgrade automático de limite: ' + CreditUI.fmtMoney(currentLimit) + ' → ' + CreditUI.fmtMoney(nextLimit),
        status:      'system',
      });
      changed = true;
    });

    if (changed) {
      // Refreshes users after upgrade
      // (caller pode checar retorno se precisar notificar)
    }
    return changed;
  },

  /* ── Aplica cupom a um usuário ── */
  applyCoupon: function(userId, code, desc, expDate) {
    var users = CreditDB.getUsers();
    var idx   = users.findIndex(function(u) { return u.id === userId; });
    if (idx === -1) return false;
    if (!users[idx].coupons) users[idx].coupons = [];
    // Prevent duplicate codes
    if (users[idx].coupons.some(function(c) { return c.code === code; })) return false;
    users[idx].coupons.push({
      code:    code.toUpperCase(),
      desc:    desc || 'Cupom especial',
      exp:     expDate || '',
      addedAt: new Date().toISOString(),
    });
    CreditDB.saveUsers(users);
    CreditDB.addTxn({ userId: userId, type: 'coupon', amount: 0, balance: CreditEngine.getAvailable(users[idx]), description: 'Cupom ' + code + ' adicionado', status: 'confirmed' });
    return true;
  },

  /* ── Score numérico público (0-100) ── */
  getScoreLabel: function(score) {
    if (score >= 80) return { label: 'Excelente', color: '#22c55e',  emoji: '⭐' };
    if (score >= 60) return { label: 'Bom',       color: '#4ade80',  emoji: '✅' };
    if (score >= 35) return { label: 'Regular',   color: '#f59e0b',  emoji: '⚠️' };
    return                  { label: 'Ruim',      color: '#ef4444',  emoji: '🚫' };
  },

  /* ── Gera mensagem WhatsApp de cobrança ── */
  buildWhatsAppMessage: function(user, storeName) {
    var debt     = user.creditUsed || 0;
    var cfg      = CreditDB.getConfig();
    var tax      = cfg.creditTax || 5;
    var total    = debt + tax;
    var daysLeft = CreditEngine.getDaysLeft(user);
    var status   = CreditEngine.getStatus(user);

    var urgency = daysLeft === null ? '' :
                  daysLeft < 0   ? '🚨 *VENCIDO há ' + Math.abs(daysLeft) + ' dias!*\n' :
                  daysLeft <= 5  ? '⚠️ *Vence em ' + daysLeft + ' dia(s)!*\n' :
                                   '📅 Vence em ' + daysLeft + ' dia(s).\n';

    var msg = '💳 *Conta Rapi10 — ' + storeName + '*\n';
    msg += '━━━━━━━━━━━━━━━━\n';
    msg += 'Olá ' + user.name + '! Tudo bem?\n\n';
    msg += urgency;
    msg += '\n💰 *Saldo devedor:* R$ ' + debt.toFixed(2).replace('.', ',');
    msg += '\n🏷️ *Taxa:* R$ ' + tax.toFixed(2).replace('.', ',');
    msg += '\n🔴 *Total a pagar:* R$ ' + total.toFixed(2).replace('.', ',');
    if (user.creditDueDate) {
      msg += '\n📆 *Vencimento:* ' + new Date(user.creditDueDate).toLocaleDateString('pt-BR');
    }
    msg += '\n\nQualquer dúvida, é só chamar! 🙏';
    msg += '\n\n_' + storeName + '_';
    return msg;
  },

  /* ── Relatório resumido ── */
  buildReport: function() {
    var users   = CreditDB.getUsers();
    var cfg     = CreditDB.getConfig();
    var txns    = CreditDB.getTxns();

    var creditUsers = users.filter(function(u) { return CreditEngine.calcLimit(u) > 0; });
    var totalDebt   = users.reduce(function(s, u) { return s + (u.creditUsed || 0); }, 0);
    var totalLimit  = creditUsers.reduce(function(s, u) { return s + CreditEngine.calcLimit(u); }, 0);
    var totalPaid   = txns.filter(function(t) { return t.type.startsWith('payment'); }).reduce(function(s, t) { return s + t.amount; }, 0);
    var overdue     = creditUsers.filter(function(u) {
      var dl = CreditEngine.getDaysLeft(u);
      return (u.creditUsed || 0) > 0 && dl !== null && dl < 0;
    });
    var warningSoon = creditUsers.filter(function(u) {
      var dl = CreditEngine.getDaysLeft(u);
      return (u.creditUsed || 0) > 0 && dl !== null && dl >= 0 && dl <= 7;
    });
    var inadRate = creditUsers.length > 0 ? (overdue.length / creditUsers.length * 100).toFixed(1) : 0;
    var tax      = cfg.creditTax || 5;
    // B11 FIXED: was reduce(function(s){return s+tax},0) — missing u param, ignoring accumulator
    var taxRevenue = overdue.reduce(function(s, u) { return s + tax + (u.creditUsed || 0); }, 0);

    return {
      creditUsers:   creditUsers.length,
      totalDebt:     totalDebt,
      totalLimit:    totalLimit,
      totalPaid:     totalPaid,
      overdue:       overdue.length,
      warningSoon:   warningSoon.length,
      inadRate:      inadRate,
      taxRevenue:    taxRevenue,
      overdueList:   overdue,
      warningList:   warningSoon,
    };
  },
};

/* ═══════════════════════════════════════════════════════════════
   FORMATTERS / HELPERS (usados em ambos os arquivos)
═══════════════════════════════════════════════════════════════ */
var CreditUI = {

  fmtMoney: function(v) {
    return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
  },

  fmtDate: function(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('pt-BR');
  },

  fmtDaysLeft: function(user) {
    var dl = CreditEngine.getDaysLeft(user);
    if (dl === null) return '—';
    if (dl < 0) return '<span style="color:#ef4444;font-weight:700">Vencido há ' + Math.abs(dl) + 'd</span>';
    if (dl === 0) return '<span style="color:#ef4444;font-weight:700">Vence hoje!</span>';
    if (dl <= 5) return '<span style="color:#f59e0b;font-weight:700">Vence em ' + dl + 'd</span>';
    return '<span style="color:#22c55e">Vence em ' + dl + 'd</span>';
  },

  statusBadge: function(user) {
    var key = CreditEngine.getStatus(user);
    var s   = CR_STATUS[key] || CR_STATUS.inactive;
    var bg  = {
      good:    'rgba(34,197,94,.12)',
      watch:   'rgba(245,158,11,.12)',
      blocked: 'rgba(239,68,68,.12)',
      inactive:'rgba(124,124,124,.1)',
    }[key];
    return '<span style="display:inline-flex;align-items:center;gap:4px;border-radius:20px;padding:3px 9px;font-size:.7rem;font-weight:700;background:' + bg + ';color:' + s.color + '">' + s.emoji + ' ' + s.label + '</span>';
  },

  rankBadge: function(user) {
    var rk = CreditEngine.getRank(user);
    if (!rk) return '<span style="color:#7c8098;font-size:.8rem">—</span>';
    var r  = CR_RANKS[rk];
    return '<span style="font-size:.75rem;font-weight:700;color:' + r.color + '">' + r.emoji + ' ' + r.label + '</span>';
  },

  scoreBar: function(user) {
    var score = CreditEngine.calcScore(user);
    var color = score >= 60 ? '#22c55e' : score >= 35 ? '#f59e0b' : '#ef4444';
    return '<div style="display:flex;align-items:center;gap:7px">'
      + '<div style="flex:1;background:#1d2235;border-radius:99px;height:6px;overflow:hidden">'
      + '<div style="width:' + score + '%;height:100%;background:' + color + ';border-radius:99px;transition:width .4s"></div></div>'
      + '<span style="font-size:.75rem;font-weight:700;color:' + color + '">' + score + '</span>'
      + '</div>';
  },

  creditCardHTML: function(user) {
    var limit = CreditEngine.calcLimit(user);
    var debt  = CreditEngine.getDebt(user);
    var avail = CreditEngine.getAvailable(user);
    var rank  = CreditEngine.getRank(user);
    var rk    = rank ? CR_RANKS[rank] : null;
    var status = CreditEngine.getStatus(user);
    var st     = CR_STATUS[status];
    var pct    = limit > 0 ? Math.min(100, (debt / limit) * 100) : 0;
    var barColor = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#22c55e';

    return '<div style="background:linear-gradient(135deg,#4c1d95,#7c3aed,#5b21b6);border-radius:18px;padding:20px;position:relative;overflow:hidden;margin-bottom:14px">'
      + '<div style="position:absolute;top:-30px;right:-30px;width:130px;height:130px;border-radius:50%;background:rgba(255,255,255,.07)"></div>'
      + '<div style="position:absolute;bottom:-40px;left:-20px;width:150px;height:150px;border-radius:50%;background:rgba(255,255,255,.05)"></div>'
      + '<div style="position:relative;z-index:1">'
        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">'
          + '<div><div style="font-size:.68rem;font-weight:700;color:rgba(255,255,255,.55);text-transform:uppercase;letter-spacing:.7px;margin-bottom:3px">Conta Rapi10</div>'
          + '<div style="font-family:\'Playfair Display\',serif;font-size:1.7rem;font-weight:900;color:#fff">' + CreditUI.fmtMoney(avail) + '</div>'
          + '<div style="font-size:.74rem;color:rgba(255,255,255,.65)">disponível</div></div>'
          + (rk ? '<div style="background:rgba(255,255,255,.15);border-radius:9px;padding:5px 11px;font-size:.78rem;font-weight:700;color:#fff;text-align:center">' + rk.emoji + '<br>' + rk.label + '</div>' : '')
        + '</div>'
        + '<div style="background:rgba(255,255,255,.12);border-radius:99px;height:5px;margin-bottom:10px;overflow:hidden">'
          + '<div style="width:' + pct.toFixed(0) + '%;height:100%;background:' + barColor + ';border-radius:99px;transition:width .5s"></div>'
        + '</div>'
        + '<div style="display:flex;justify-content:space-between">'
          + '<div style="font-size:.73rem;color:rgba(255,255,255,.65)">Limite total<br><strong style="color:#fff;font-size:.86rem">' + CreditUI.fmtMoney(limit) + '</strong></div>'
          + '<div style="font-size:.73rem;color:rgba(255,255,255,.65);text-align:center">Usado<br><strong style="color:#fff;font-size:.86rem">' + CreditUI.fmtMoney(debt) + '</strong></div>'
          + '<div style="font-size:.73rem;color:rgba(255,255,255,.65);text-align:right">Status<br><strong style="color:' + st.color + ';font-size:.82rem">' + st.emoji + ' ' + st.label + '</strong></div>'
        + '</div>'
      + '</div>'
    + '</div>';
  },

  /* ── Histórico de transações ── */
  txnListHTML: function(userId, limit) {
    var txns = CreditDB.getUserTxns(userId).slice(0, limit || 20);
    if (!txns.length) return '<div style="text-align:center;padding:20px;color:#7a6452;font-size:.84rem">Nenhuma movimentação ainda</div>';

    var typeInfo = {
      purchase:       { ico: '🛒', label: 'Compra no crédito',   color: '#ef4444' },
      payment_on_time:{ ico: '✅', label: 'Pagamento em dia',     color: '#22c55e' },
      payment_late:   { ico: '⚠️', label: 'Pagamento atrasado',  color: '#f59e0b' },
      payment_overdue:{ ico: '🚨', label: 'Pagamento vencido',    color: '#ef4444' },
      manual_debt:    { ico: '➕', label: 'Débito manual',        color: '#f97316' },
      limit_change:   { ico: '🔧', label: 'Alteração de limite',  color: '#8b5cf6' },
      auto_block:     { ico: '🔒', label: 'Bloqueio automático',  color: '#ef4444' },
      coupon:         { ico: '🎟️', label: 'Cupom aplicado',       color: '#f5c842' },
    };

    return txns.map(function(t) {
      var ti = typeInfo[t.type] || { ico: '💳', label: t.type, color: '#8b5cf6' };
      var amtColor = t.amount < 0 ? '#ef4444' : '#22c55e';
      var amtPrefix = t.amount < 0 ? '' : '+';
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(232,160,32,.1)">'
        + '<div style="font-size:1.3rem;flex-shrink:0">' + ti.ico + '</div>'
        + '<div style="flex:1;min-width:0">'
          + '<div style="font-weight:600;font-size:.84rem">' + t.description + '</div>'
          + '<div style="font-size:.72rem;color:#7a6452;margin-top:1px">' + CreditUI.fmtDate(t.createdAt) + (t.adminNote ? ' · ' + t.adminNote : '') + '</div>'
        + '</div>'
        + '<div style="text-align:right;flex-shrink:0">'
          + '<div style="font-weight:700;font-size:.88rem;color:' + amtColor + '">' + amtPrefix + CreditUI.fmtMoney(Math.abs(t.amount)) + '</div>'
          + '<div style="font-size:.7rem;color:#7a6452">saldo: ' + CreditUI.fmtMoney(t.balance) + '</div>'
        + '</div>'
      + '</div>';
    }).join('');
  },

  /* ── Alerta de vencimento (usado no perfil do cliente) ── */
  dueAlertHTML: function(user) {
    var dl   = CreditEngine.getDaysLeft(user);
    var debt = CreditEngine.getDebt(user);
    if (debt <= 0 || dl === null) return '';

    var cfg  = CreditDB.getConfig();
    var tax  = cfg.creditTax || 5;
    var total = debt + tax;

    if (dl < 0) {
      return '<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:12px;padding:14px 16px;margin-bottom:14px">'
        + '<div style="font-weight:700;color:#ef4444;margin-bottom:5px">🚨 Pagamento em atraso!</div>'
        + '<div style="font-size:.83rem;color:#c9b59a">Sua conta venceu há <strong>' + Math.abs(dl) + ' dias</strong>. O acesso ao crédito está bloqueado até a quitação.</div>'
        + '<div style="margin-top:10px;font-weight:700;font-size:.9rem">Total a pagar: <span style="color:#f87171">' + CreditUI.fmtMoney(total) + '</span></div>'
      + '</div>';
    }
    if (dl <= 5) {
      return '<div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:12px;padding:14px 16px;margin-bottom:14px">'
        + '<div style="font-weight:700;color:#f59e0b;margin-bottom:5px">⚠️ Vence em ' + dl + ' dia(s)!</div>'
        + '<div style="font-size:.83rem;color:#c9b59a">Não esqueça de quitar seu saldo para manter o crédito ativo.</div>'
        + '<div style="margin-top:10px;font-weight:700;font-size:.9rem">Total a pagar: <span style="color:#fbbf24">' + CreditUI.fmtMoney(total) + '</span></div>'
      + '</div>';
    }
    return '';
  },
};

/* ═══════════════════════════════════════════════════════════════
   SUPABASE ADAPTER (estrutura das tabelas para futura migração)
   Quando quiser migrar, substitua CreditDB pelos adapters abaixo
═══════════════════════════════════════════════════════════════ */
/*
-- SQL para criar as tabelas no Supabase:

CREATE TABLE clientes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  phone       TEXT,
  address     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE carteira_credito (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES clientes(id) ON DELETE CASCADE,
  limit_override      NUMERIC(10,2) DEFAULT NULL,
  credit_used         NUMERIC(10,2) DEFAULT 0,
  credit_due_date     TIMESTAMPTZ,
  blocked             BOOLEAN DEFAULT FALSE,
  auto_blocked        BOOLEAN DEFAULT FALSE,
  block_reason        TEXT,
  score               SMALLINT DEFAULT 50,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE transacoes_credito (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES clientes(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,       -- purchase | payment_on_time | payment_late | ...
  amount      NUMERIC(10,2),       -- negativo = débito, positivo = crédito
  balance     NUMERIC(10,2),       -- saldo após a transação
  description TEXT,
  order_id    TEXT,
  admin_note  TEXT,
  status      TEXT DEFAULT 'confirmed',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE carteira_credito    ENABLE ROW LEVEL SECURITY;
ALTER TABLE transacoes_credito  ENABLE ROW LEVEL SECURITY;

-- Clientes veem apenas seus próprios dados
CREATE POLICY "own_wallet" ON carteira_credito    USING (user_id = auth.uid());
CREATE POLICY "own_txns"   ON transacoes_credito  USING (user_id = auth.uid());

-- Admins veem tudo (service_role key)
*/

/* ─── Exporta globalmente (compatível com script inline) ─── */
if (typeof window !== 'undefined') {
  window.CreditDB     = CreditDB;
  window.CreditEngine = CreditEngine;
  window.CreditUI     = CreditUI;
  window.CR_STATUS    = CR_STATUS;
  window.CR_RANKS     = CR_RANKS;
}
/* ═══════════════════════════════════════════════════════════════
   MELHORIAS DIFERENCIAIS — adicionado v1.1
═══════════════════════════════════════════════════════════════ */

/* ── 1. COUPON VALIDATOR — valida e aplica cupons ── */
var CreditCoupons = {

  /** Aplica cupom a um usuário. Retorna { ok, discount, msg } */
  apply: function(userId, code) {
    var users = CreditDB.getUsers();
    var idx   = users.findIndex(function(u) { return u.id === userId; });
    if (idx === -1) return { ok: false, msg: 'Usuário não encontrado' };
    var u = users[idx];
    var coupons = u.coupons || [];
    var coupon  = coupons.find(function(c) { return c.code === code.trim().toUpperCase() && !c.used; });
    if (!coupon) return { ok: false, msg: 'Cupom inválido ou já utilizado' };
    // Expiry check
    if (coupon.exp && new Date(coupon.exp) < new Date()) return { ok: false, msg: 'Cupom expirado' };
    // Mark as used
    coupon.used   = true;
    coupon.usedAt = new Date().toISOString();
    users[idx].coupons = coupons;
    CreditDB.saveUsers(users);
    CreditDB.addTxn({ userId: userId, type: 'coupon', amount: coupon.discount || 0,
      balance: CreditEngine.getAvailable(u), description: 'Cupom aplicado: ' + code, status: 'confirmed' });
    return { ok: true, discount: coupon.discount || 0, msg: 'Cupom aplicado!' };
  },

  /** Gera código aleatório legível */
  generate: function(prefix) {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var code  = (prefix || 'RAPI') + '-';
    for (var i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  },
};

/* ── 2. CREDIT ANALYTICS — métricas avançadas ── */
var CreditAnalytics = {

  /** Retorna distribuição de score por faixa */
  scoreDistribution: function() {
    var users = CreditDB.getUsers();
    var dist  = { good: 0, watch: 0, blocked: 0, inactive: 0 };
    users.forEach(function(u) {
      var status = CreditEngine.getStatus(u);
      dist[status] = (dist[status] || 0) + 1;
    });
    return dist;
  },

  /** Top N clientes por frequência de pedidos */
  topCustomers: function(n) {
    var users  = CreditDB.getUsers();
    var orders = CreditDB.getOrders();
    return users.map(function(u) {
      var ords  = orders.filter(function(o) { return o.customerEmail === u.email; });
      var spent = ords.reduce(function(s, o) { return s + (o.total || 0); }, 0);
      return { user: u, orderCount: ords.length, totalSpent: spent };
    })
    .sort(function(a, b) { return b.totalSpent - a.totalSpent; })
    .slice(0, n || 10);
  },

  /** Receita por dia da semana */
  revenueByWeekday: function() {
    var orders = CreditDB.getOrders().filter(function(o) { return o.status === 'delivered'; });
    var days   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    var result = days.map(function(d) { return { label: d, total: 0, count: 0 }; });
    orders.forEach(function(o) {
      var d = new Date(o.createdAt).getDay();
      result[d].total += (o.total || 0);
      result[d].count++;
    });
    return result;
  },

  /** Ticket médio por forma de pagamento */
  ticketByPayment: function() {
    var orders = CreditDB.getOrders();
    var map    = {};
    orders.forEach(function(o) {
      var p = o.payment || 'outros';
      if (!map[p]) map[p] = { count: 0, total: 0 };
      map[p].count++;
      map[p].total += (o.total || 0);
    });
    return Object.keys(map).map(function(k) {
      return { payment: k, count: map[k].count, avg: map[k].total / map[k].count };
    }).sort(function(a, b) { return b.avg - a.avg; });
  },
};

/* ── 3. NOTIFICATION TEMPLATES — mensagens ricas para WA ── */
CreditEngine.buildWelcomeMessage = function(user, storeName) {
  var cfg = CreditDB.getConfig();
  var min = cfg.creditMinOrders || 5;
  return '🎉 *Bem-vindo ao ' + storeName + '!*\n\n'
    + 'Olá ' + user.name + '! Que ótimo ter você aqui 😊\n\n'
    + '💳 *Conta Rapi10*\n'
    + 'Faça ' + min + ' pedidos e libere crédito automático de até '
    + 'R$ ' + ((cfg.creditLevels || [20,40,60])[0]).toFixed(2).replace('.',',') + '!\n\n'
    + '_' + storeName + '_';
};

CreditEngine.buildUpgradeMessage = function(user, storeName) {
  var rank = CreditEngine.getRank(user);
  var rk   = rank ? CR_RANKS[rank] : null;
  var lim  = CreditEngine.calcLimit(user);
  return rk
    ? '🥳 *Parabéns, ' + user.name.split(' ')[0] + '!*\n\n'
      + 'Seu crédito foi升级 para ' + rk.emoji + ' *' + rk.label + '*!\n'
      + '💳 Novo limite: *R$ ' + lim.toFixed(2).replace('.',',') + '*\n\n'
      + 'Continue pedindo e suba ainda mais! 🚀\n\n_' + storeName + '_'
    : '';
};

/* ── 4. DATA EXPORT — CSV para planilha ── */
CreditDB.exportCSV = function() {
  var users  = CreditDB.getUsers();
  var orders = CreditDB.getOrders();
  var header = 'Nome,Email,Telefone,Pedidos,Gasto Total,Limite,Usado,Disponível,Score,Status,Vencimento';
  var rows   = users.map(function(u) {
    var ords  = orders.filter(function(o) { return o.customerEmail === u.email; });
    var spent = ords.reduce(function(s, o) { return s + (o.total || 0); }, 0);
    var lim   = CreditEngine.calcLimit(u);
    var debt  = u.creditUsed || 0;
    var avail = Math.max(0, lim - debt);
    var score = CreditEngine.calcScore(u);
    var status = CR_STATUS[CreditEngine.getStatus(u)].label;
    var due   = u.creditDueDate ? new Date(u.creditDueDate).toLocaleDateString('pt-BR') : '';
    return [
      '"' + (u.name||'').replace(/"/g,'""') + '"',
      u.email || '',
      u.phone || '',
      ords.length,
      spent.toFixed(2),
      lim.toFixed(2),
      debt.toFixed(2),
      avail.toFixed(2),
      score,
      status,
      due
    ].join(',');
  });
  return header + '\n' + rows.join('\n');
};

/* ─── Re-export with new members ─── */
if (typeof window !== 'undefined') {
  window.CreditCoupons   = CreditCoupons;
  window.CreditAnalytics = CreditAnalytics;
}
