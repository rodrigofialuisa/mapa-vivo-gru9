/**
 * ══════════════════════════════════════════════════════════════════
 *  SUPABASE ADAPTER — supabase-adapter.js  v2.0
 *  Expõe window.Supa para cardapio.html e admin.html
 *  Zero breaking changes: mantém localStorage como cache/fallback
 *  Compatível com credito.js, entrega.js, DeliveryEngine, CreditEngine
 * ══════════════════════════════════════════════════════════════════
 */
(function(global) {
  'use strict';

  /* ── Aguarda config injetada pelo host ── */
  var CFG_KEY = 'SUPA_CONFIG';
  var _cfg = global[CFG_KEY] || {};
  var SUPA_URL  = _cfg.url     || '';
  var ANON_KEY  = _cfg.anonKey || '';
  var FNS_BASE  = _cfg.fnsBase || (SUPA_URL + '/functions/v1');
  var ADMIN_TOKEN_KEY = 'admin_token';

  if (!SUPA_URL) {
    console.warn('[Supa] SUPA_CONFIG.url não configurado — usando localStorage puro.');
  }

  /* ═══════════════════════════════════════════════════════════════
     CLIENTE SUPABASE (REST direto, sem SDK extra — apenas fetch)
  ═══════════════════════════════════════════════════════════════ */
  var sb = {
    /* GET /rest/v1/{table} */
    from: function(table) {
      return {
        _table: table,
        _filters: [],
        _order: null,
        _limit: null,
        select: function(cols) { this._cols = cols || '*'; return this; },
        eq: function(col, val) { this._filters.push(col + '=eq.' + encodeURIComponent(val)); return this; },
        gt: function(col, val) { this._filters.push(col + '=gt.' + encodeURIComponent(val)); return this; },
        lte: function(col, val){ this._filters.push(col + '=lte.'+encodeURIComponent(val)); return this; },
        is: function(col, val) { this._filters.push(col + '=is.' + val); return this; },
        order: function(col, opts) {
          this._order = col + '.' + ((opts && opts.ascending === false) ? 'desc' : 'asc');
          return this;
        },
        limit: function(n) { this._limit = n; return this; },
        single: function() { this._single = true; return this; },
        _url: function() {
          var url = SUPA_URL + '/rest/v1/' + this._table + '?select=' + (this._cols || '*');
          this._filters.forEach(function(f) { url += '&' + f; });
          if (this._order) url += '&order=' + this._order;
          if (this._limit) url += '&limit=' + this._limit;
          return url;
        },
        _headers: function(extra) {
          var h = {
            'apikey': ANON_KEY,
            'Authorization': 'Bearer ' + _getAuthToken(),
            'Content-Type': 'application/json',
          };
          if (this._single) h['Accept'] = 'application/vnd.pgrst.object+json';
          return Object.assign(h, extra || {});
        },
        get: function() {
          var self = this;
          return fetch(self._url(), { headers: self._headers() })
            .then(function(r) { return r.json().then(function(d){ return {data:d, error: r.ok?null:{message:d.message||r.statusText}}; }); })
            .catch(function(e) { return {data: null, error: {message: e.message}}; });
        },
        insert: function(body) {
          var self = this;
          return fetch(SUPA_URL + '/rest/v1/' + self._table, {
            method: 'POST',
            headers: self._headers({'Prefer':'return=representation'}),
            body: JSON.stringify(body)
          }).then(function(r){ return r.json().then(function(d){ return {data:d, error:r.ok?null:{message:d.message||r.statusText}}; }); })
            .catch(function(e){ return {data:null, error:{message:e.message}}; });
        },
        update: function(body) {
          var self = this;
          return fetch(self._url(), {
            method: 'PATCH',
            headers: self._headers({'Prefer':'return=representation'}),
            body: JSON.stringify(body)
          }).then(function(r){ return r.json().then(function(d){ return {data:d, error:r.ok?null:{message:d.message||r.statusText}}; }); })
            .catch(function(e){ return {data:null, error:{message:e.message}}; });
        },
        upsert: function(body) {
          var self = this;
          return fetch(SUPA_URL + '/rest/v1/' + self._table, {
            method: 'POST',
            headers: self._headers({'Prefer':'return=representation,resolution=merge-duplicates'}),
            body: JSON.stringify(body)
          }).then(function(r){ return r.json().then(function(d){ return {data:d, error:r.ok?null:{message:d.message||r.statusText}}; }); })
            .catch(function(e){ return {data:null, error:{message:e.message}}; });
        },
        delete: function() {
          var self = this;
          return fetch(self._url(), {
            method: 'DELETE',
            headers: self._headers({'Prefer':'return=representation'})
          }).then(function(r){ return r.json().then(function(d){ return {data:d, error:r.ok?null:{message:d.message||r.statusText}}; }); })
            .catch(function(e){ return {data:null, error:{message:e.message}}; });
        },
      };
    },

    /* RPC */
    rpc: function(fn, params) {
      return fetch(SUPA_URL + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + _getAuthToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify(params || {})
      }).then(function(r){ return r.json().then(function(d){ return {data:d, error:r.ok?null:{message:d.message||r.statusText}}; }); })
        .catch(function(e){ return {data:null, error:{message:e.message}}; });
    },

    /* Auth */
    auth: {
      signUp: function(opts) {
        return fetch(SUPA_URL + '/auth/v1/signup', {
          method: 'POST',
          headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: opts.email, password: opts.password, data: opts.data || {} })
        }).then(function(r){ return r.json().then(function(d){ return {data:d, error:r.ok?null:{message:d.error_description||d.msg||r.statusText}}; }); })
          .catch(function(e){ return {data:null, error:{message:e.message}}; });
      },
      signIn: function(opts) {
        return fetch(SUPA_URL + '/auth/v1/token?grant_type=password', {
          method: 'POST',
          headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: opts.email, password: opts.password })
        }).then(function(r){ return r.json().then(function(d){ return {data:d, error:r.ok?null:{message:d.error_description||d.msg||r.statusText}}; }); })
          .catch(function(e){ return {data:null, error:{message:e.message}}; });
      },
      signOut: function() {
        return fetch(SUPA_URL + '/auth/v1/logout', {
          method: 'POST',
          headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + _getAuthToken() }
        }).catch(function(){});
      },
      getUser: function() {
        return fetch(SUPA_URL + '/auth/v1/user', {
          headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + _getAuthToken() }
        }).then(function(r){ return r.json().then(function(d){ return {data:{user:r.ok?d:null}, error:r.ok?null:{message:d.msg||r.statusText}}; }); })
          .catch(function(e){ return {data:{user:null}, error:{message:e.message}}; });
      }
    }
  };

  /* ─── Helpers internos ─── */
  function _getAuthToken() {
    /* Cliente usa Supabase Auth token; admin usa JWT customizado */
    try { return localStorage.getItem(ADMIN_TOKEN_KEY) || localStorage.getItem('supa_client_token') || ANON_KEY; } catch(e) { return ANON_KEY; }
  }

  function _callFn(name, payload, adminAuth) {
    var headers = { 'Content-Type': 'application/json', 'apikey': ANON_KEY };
    if (adminAuth) {
      var tok = localStorage.getItem(ADMIN_TOKEN_KEY);
      if (tok) headers['Authorization'] = 'Bearer ' + tok;
    } else {
      var ctok = localStorage.getItem('supa_client_token');
      if (ctok) headers['Authorization'] = 'Bearer ' + ctok;
    }
    return fetch(FNS_BASE + '/' + name, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload || {})
    })
    .then(function(r) {
      return r.json().then(function(d) {
        _emit('supa:sync', { status: r.ok ? 'ok' : 'error', fn: name });
        return { data: d, error: r.ok ? null : { message: d.error || d.message || r.statusText } };
      });
    })
    .catch(function(e) {
      _emit('supa:sync', { status: 'error', fn: name, message: e.message });
      return { data: null, error: { message: e.message } };
    });
  }

  function _emit(evName, detail) {
    try { global.dispatchEvent(new CustomEvent(evName, { detail: detail })); } catch(e) {}
  }

  /* map Supabase menu_items row → formato interno cardapio */
  function _mapMenuItem(row) {
    return {
      _uuid:      row.id,
      id:         row.legacy_id || row.id,
      category:   row.category,
      emoji:      row.emoji || '🍽️',
      name:       row.name,
      desc:       row.description || '',
      price:      Number(row.price),
      promo:      row.promo || null,
      imageUrl:   row.image_url || '',
      available:  row.available !== false,
      isNew:      row.is_new || false,
      tags:       row.tags || [],
      upsells:    row.upsells || [],
      salesCount: row.sales_count || 0,
    };
  }

  /* map Supabase lojas row → CFG formato cardapio */
  function _mapLoja(row) {
    return {
      storeName:      row.store_name,
      heroTitle:      row.hero_title,
      heroSub:        row.hero_sub,
      whatsapp:       row.whatsapp,
      currency:       row.currency || 'R$',
      hours:          row.hours || '',
      isOpen:         row.is_open,
      closedMsg:      row.closed_msg || '',
      paymentMethods: row.payment_methods || ['dinheiro','pix'],
      minOrder:       Number(row.min_order || 0),
      creditTax:      Number(row.credit_tax || 5),
      creditLevels:   (row.credit_levels || [20,40,60]).map(Number),
      creditMinOrders:row.credit_min_orders || 5,
      creditDays:     row.credit_days || 30,
      cloudName:      row.cloudinary_cloud_name || '',
      cloudPreset:    row.cloudinary_preset || '',
      mpPublicKey:    row.mp_public_key || '',
      deliveryOrigin: row.delivery_origin || '',
      deliveryFee:    Number(row.delivery_fee || 0),
      delivery: {
        zona1_km:    Number(row.zona1_km || 1),
        zona1_taxa:  Number(row.zona1_taxa || 2),
        zona1_tempo: row.zona1_tempo || '10–20 min',
        zona1_metodo:row.zona1_metodo || 'propria',
        zona2_km:    Number(row.zona2_km || 3),
        zona2_base:  Number(row.zona2_base || 5),
        zona2_pkm:   Number(row.zona2_pkm || 2),
        zona2_minimo:Number(row.zona2_minimo || 20),
        zona2_tempo: row.zona2_tempo || '20–40 min',
        zona2_metodo:row.zona2_metodo || 'motoboy',
        zona3_msg:   row.zona3_msg || 'Atendemos apenas esta região no momento 🙏',
      }
    };
  }

  /* map pedido interno → Supabase insert payload */
  function _mapOrderToSupa(order) {
    return {
      id:                 order.id,
      customer_name:      order.customer,
      customer_phone:     order.phone,
      customer_email:     order.customerEmail || '',
      address:            order.address || '',
      obs:                order.obs || '',
      delivery_mode:      order.deliveryMode || 'entrega',
      delivery_zona:      order.deliveryZona || null,
      delivery_metodo:    order.deliveryMetodo || null,
      delivery_distancia: order.deliveryDistancia || null,
      delivery_tempo:     order.deliveryTempo || null,
      delivery_taxa:      Number(order.deliveryTaxa || order.fee || 0),
      payment:            order.payment || 'pix',
      troco:              Number(order.troco || 0),
      subtotal:           Number(order.subtotal || 0),
      fee:                Number(order.fee || 0),
      credit_used:        Number(order.creditUsed || 0),
      total:              Number(order.total || 0),
      status:             order.status || 'pending',
      items:              order.items || [],
    };
  }

  /* map Supabase pedido row → formato interno admin */
  function _mapOrderFromSupa(row) {
    return {
      id:               row.id,
      customer:         row.customer_name,
      phone:            row.customer_phone,
      customerEmail:    row.customer_email,
      address:          row.address,
      obs:              row.obs,
      deliveryMode:     row.delivery_mode,
      deliveryZona:     row.delivery_zona,
      deliveryMetodo:   row.delivery_metodo,
      deliveryDistancia:row.delivery_distancia,
      deliveryTempo:    row.delivery_tempo,
      deliveryTaxa:     row.delivery_taxa,
      payment:          row.payment,
      troco:            row.troco,
      subtotal:         row.subtotal,
      fee:              row.fee,
      creditUsed:       row.credit_used,
      total:            row.total,
      status:           row.status,
      items:            row.items || [],
      createdAt:        row.created_at,
      updatedAt:        row.updated_at,
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     REALTIME — Supabase Realtime via WebSocket
  ═══════════════════════════════════════════════════════════════ */
  var _rtSocket = null;
  var _rtSubs   = {};  // channel → [callback]

  function _rtConnect() {
    if (!SUPA_URL || _rtSocket) return;
    var wsUrl = SUPA_URL.replace('https://', 'wss://').replace('http://', 'ws://')
      + '/realtime/v1/websocket?apikey=' + ANON_KEY + '&vsn=1.0.0';
    try {
      _rtSocket = new WebSocket(wsUrl);
      _rtSocket.onopen = function() {
        _emit('supa:realtime:connected', {});
        Object.keys(_rtSubs).forEach(function(ch) { _rtJoin(ch); });
      };
      _rtSocket.onmessage = function(e) {
        try {
          var msg = JSON.parse(e.data);
          if (msg.event === 'phx_reply' && msg.payload && msg.payload.response) {
            var table = (msg.topic || '').replace('realtime:','');
            var handlers = _rtSubs[table] || [];
            handlers.forEach(function(fn) { fn(msg.payload.response); });
          }
        } catch(err) {}
      };
      _rtSocket.onclose = function() {
        _rtSocket = null;
        setTimeout(_rtConnect, 5000); // reconnect
      };
      _rtSocket.onerror = function() { _emit('supa:sync', {status:'error', fn:'realtime'}); };
    } catch(e) {}
  }

  function _rtJoin(channel) {
    if (!_rtSocket || _rtSocket.readyState !== 1) return;
    _rtSocket.send(JSON.stringify({
      topic: 'realtime:' + channel,
      event: 'phx_join',
      payload: { config: { postgres_changes: [{ event: '*', schema: 'public', table: channel }] } },
      ref: channel
    }));
  }

  function _subscribe(table, callback) {
    if (!_rtSubs[table]) _rtSubs[table] = [];
    _rtSubs[table].push(callback);
    if (_rtSocket && _rtSocket.readyState === 1) _rtJoin(table);
    else _rtConnect();
  }

  /* ═══════════════════════════════════════════════════════════════
     CACHE LOCAL — localStorage como camada de leitura rápida
  ═══════════════════════════════════════════════════════════════ */
  var _cache = {
    set: function(k, v) { try { localStorage.setItem('_supa_' + k, JSON.stringify(v)); } catch(e) {} },
    get: function(k)    { try { var v = localStorage.getItem('_supa_' + k); return v ? JSON.parse(v) : null; } catch(e) { return null; } },
    del: function(k)    { try { localStorage.removeItem('_supa_' + k); } catch(e) {} },
  };

  /* ═══════════════════════════════════════════════════════════════
     API PÚBLICA — window.Supa
  ═══════════════════════════════════════════════════════════════ */

  var Supa = {

    /* ── Auth (cliente) ── */
    Auth: {
      signUp: function(opts) {
        /* Registra no Supabase Auth + cria registro em clientes */
        return sb.auth.signUp({
          email:    opts.email,
          password: opts.password,
          data:     { full_name: opts.name, phone: opts.phone }
        }).then(function(res) {
          if (res.error) return res;
          /* Salva token de sessão */
          if (res.data && res.data.access_token) {
            localStorage.setItem('supa_client_token', res.data.access_token);
          }
          /* Cria entrada na tabela clientes */
          return sb.from('clientes').insert({
            name:    opts.name,
            email:   opts.email.toLowerCase(),
            phone:   opts.phone  || '',
            address: opts.address|| '',
            pwd_hash: '(supabase-auth)',
          }).then(function() { return res; });
        });
      },

      signIn: function(opts) {
        return sb.auth.signIn({ email: opts.email, password: opts.password })
          .then(function(res) {
            if (res.error) return res;
            if (res.data && res.data.access_token) {
              localStorage.setItem('supa_client_token', res.data.access_token);
            }
            return res;
          });
      },

      signOut: function() {
        localStorage.removeItem('supa_client_token');
        return sb.auth.signOut();
      },

      getUser: function() {
        return sb.auth.getUser();
      },

      isLogged: function() {
        return !!localStorage.getItem('supa_client_token');
      }
    },

    /* ── Auth (admin) ── */
    Admin: {
      login: function(username, password) {
        return _callFn('admin-login', { username: username, password: password }, false)
          .then(function(res) {
            if (res.data && res.data.token) {
              localStorage.setItem(ADMIN_TOKEN_KEY, res.data.token);
              _emit('supa:admin:login', { ok: true });
            }
            return res;
          });
      },

      isLogged: function() {
        return !!localStorage.getItem(ADMIN_TOKEN_KEY);
      },

      logout: function() {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        _emit('supa:admin:logout', {});
      },

      /* Chamada genérica para admin-api */
      call: function(action, payload) {
        return _callFn('admin-api', Object.assign({ action: action }, payload || {}), true);
      }
    },

    /* ── Loja (config) ── */
    Loja: {
      get: function() {
        var cached = _cache.get('loja');
        if (cached) return Promise.resolve({ data: cached, error: null });
        return sb.from('lojas').select('*').single().get()
          .then(function(res) {
            if (!res.error && res.data) {
              var mapped = _mapLoja(res.data);
              _cache.set('loja', mapped);
              /* Atualiza localStorage para compatibilidade com entrega.js / CFG */
              try { localStorage.setItem('store_config', JSON.stringify(mapped)); } catch(e) {}
              _emit('supa:loja', mapped);
            }
            return res;
          });
      },

      update: function(patch) {
        /* Converte de volta para formato Supabase */
        var row = {
          store_name:          patch.storeName,
          hero_title:          patch.heroTitle,
          hero_sub:            patch.heroSub,
          whatsapp:            patch.whatsapp,
          hours:               patch.hours,
          is_open:             patch.isOpen,
          closed_msg:          patch.closedMsg,
          payment_methods:     patch.paymentMethods,
          min_order:           patch.minOrder,
          credit_tax:          patch.creditTax,
          credit_levels:       patch.creditLevels,
          credit_min_orders:   patch.creditMinOrders,
          credit_days:         patch.creditDays,
          delivery_origin:     patch.deliveryOrigin,
          delivery_fee:        patch.deliveryFee,
        };
        if (patch.delivery) {
          Object.assign(row, {
            zona1_km: patch.delivery.zona1_km, zona1_taxa: patch.delivery.zona1_taxa,
            zona1_tempo: patch.delivery.zona1_tempo, zona1_metodo: patch.delivery.zona1_metodo,
            zona2_km: patch.delivery.zona2_km, zona2_base: patch.delivery.zona2_base,
            zona2_pkm: patch.delivery.zona2_pkm, zona2_minimo: patch.delivery.zona2_minimo,
            zona2_tempo: patch.delivery.zona2_tempo, zona2_metodo: patch.delivery.zona2_metodo,
            zona3_msg: patch.delivery.zona3_msg,
          });
        }
        /* Remove undefined keys */
        Object.keys(row).forEach(function(k) { if (row[k] === undefined) delete row[k]; });

        return sb.from('lojas').eq('id', _cache.get('loja_id') || '').update(row)
          .then(function(res) {
            _cache.del('loja');
            /* Tenta via admin-api se update direto falhar (RLS) */
            if (res.error) {
              return _callFn('admin-api', { action: 'update_loja', patch: row }, true);
            }
            _emit('supa:loja', patch);
            return res;
          });
      }
    },

    /* ── Menu ── */
    Menu: {
      list: function() {
        return sb.from('menu_items').select('*').order('sales_count', {ascending:false}).get()
          .then(function(res) {
            if (!res.error && res.data) {
              var mapped = (Array.isArray(res.data) ? res.data : [res.data]).map(_mapMenuItem);
              _cache.set('menu', mapped);
              try { localStorage.setItem('menu_data', JSON.stringify(mapped)); } catch(e) {}
              _emit('supa:menu', mapped);
              return { data: mapped, error: null };
            }
            /* Fallback localStorage */
            try {
              var local = JSON.parse(localStorage.getItem('menu_data') || '[]');
              return { data: local, error: res.error };
            } catch(e) { return { data: [], error: res.error }; }
          });
      },

      upsert: function(item) {
        var row = {
          category:    item.category,
          emoji:       item.emoji || '🍽️',
          name:        item.name,
          description: item.desc || '',
          price:       Number(item.price),
          promo:       item.promo || null,
          image_url:   item.imageUrl || item.image || '',
          available:   item.available !== false,
          is_new:      item.isNew || false,
          tags:        item.tags || [],
          upsells:     item.upsells || [],
        };
        if (item._uuid) row.id = item._uuid;

        return _callFn('admin-api', { action: 'upsert_menu', item: row }, true)
          .then(function(res) {
            _cache.del('menu');
            return Supa.Menu.list().then(function() { return res; });
          });
      },

      remove: function(uuid) {
        return _callFn('admin-api', { action: 'delete_menu', id: uuid }, true)
          .then(function(res) {
            _cache.del('menu');
            return Supa.Menu.list().then(function() { return res; });
          });
      }
    },

    /* ── Categorias ── */
    Categories: {
      list: function() {
        return sb.from('categorias').select('*').order('ordem').get()
          .then(function(res) {
            if (!res.error && res.data) {
              var data = Array.isArray(res.data) ? res.data : [res.data];
              _cache.set('categories', data);
              try { localStorage.setItem('categories', JSON.stringify(data)); } catch(e) {}
              _emit('supa:categories', data);
              return { data: data, error: null };
            }
            try {
              var local = JSON.parse(localStorage.getItem('categories') || '[]');
              return { data: local, error: res.error };
            } catch(e) { return { data: [], error: res.error }; }
          });
      },

      upsert: function(cat) {
        return _callFn('admin-api', { action: 'upsert_category', category: cat }, true)
          .then(function(res) { _cache.del('categories'); return Supa.Categories.list().then(function(){ return res; }); });
      },

      remove: function(uuid) {
        return _callFn('admin-api', { action: 'delete_category', id: uuid }, true)
          .then(function(res) { _cache.del('categories'); return Supa.Categories.list().then(function(){ return res; }); });
      }
    },

    /* ── Pedidos ── */
    Pedidos: {
      list: function(filters) {
        var q = sb.from('pedidos').select('*').order('created_at', {ascending:false});
        if (filters && filters.status) q = q.eq('status', filters.status);
        if (filters && filters.limit)  q = q.limit(filters.limit);
        return q.get().then(function(res) {
          if (!res.error && res.data) {
            var data = (Array.isArray(res.data) ? res.data : [res.data]).map(_mapOrderFromSupa);
            _cache.set('orders', data);
            try { localStorage.setItem('orders', JSON.stringify(data)); } catch(e) {}
            _emit('supa:orders', data);
            return { data: data, error: null };
          }
          try {
            var local = JSON.parse(localStorage.getItem('orders') || '[]');
            return { data: local, error: res.error };
          } catch(e) { return { data: [], error: res.error }; }
        });
      },

      updateStatus: function(id, status) {
        return _callFn('admin-api', { action: 'update_order_status', id: id, status: status }, true)
          .then(function(res) {
            /* Atualiza cache local imediatamente */
            try {
              var orders = JSON.parse(localStorage.getItem('orders') || '[]');
              var idx = orders.findIndex(function(o) { return o.id === id; });
              if (idx > -1) { orders[idx].status = status; orders[idx].updatedAt = new Date().toISOString(); }
              localStorage.setItem('orders', JSON.stringify(orders));
              _emit('supa:orders', orders);
            } catch(e) {}
            return res;
          });
      },

      remove: function(id) {
        return _callFn('admin-api', { action: 'delete_order', id: id }, true)
          .then(function(res) { return Supa.Pedidos.list().then(function(){ return res; }); });
      }
    },

    /* ── Criar pedido (cliente) ── */
    createOrder: function(order) {
      var payload = _mapOrderToSupa(order);
      return _callFn('create-order', payload, false)
        .then(function(res) {
          if (!res.error) {
            /* Persiste no localStorage para histórico offline */
            try {
              var orders = JSON.parse(localStorage.getItem('orders') || '[]');
              orders.unshift(order);
              localStorage.setItem('orders', JSON.stringify(orders));
            } catch(e) {}
          }
          return res;
        });
    },

    /* ── Pagamento Mercado Pago Pix ── */
    createMpPayment: function(opts) {
      return _callFn('mp-create-payment', {
        pedido_id:   opts.pedido_id,
        amount:      opts.amount,
        payer_email: opts.payer_email,
        description: opts.description || 'Pedido ' + opts.pedido_id,
      }, false);
    },

    /* ── Geocoding (proxy Edge Function → Nominatim) ── */
    geocode: function(address) {
      /* Tenta Edge Function primeiro; fallback para entrega.js local */
      return _callFn('geocode', { address: address }, false)
        .then(function(res) {
          if (!res.error && res.data && res.data.lat) return res;
          /* Fallback: usa entrega.js DeliveryEngine diretamente */
          if (global.DeliveryEngine) {
            return global.DeliveryEngine.calcularDistancia(address)
              .then(function(km) { return { data: { km: km }, error: null }; })
              .catch(function(e) { return { data: null, error: { message: e.message } }; });
          }
          return res;
        });
    },

    distance: function(origin, destination) {
      return _callFn('geocode-gmaps', { origin: origin, destination: destination, mode: 'distance' }, false)
        .catch(function() {
          /* Fallback: usa DeliveryEngine haversine */
          if (global.DeliveryEngine) {
            return global.DeliveryEngine.calcularDistancia(destination)
              .then(function(km) { return { data: { km: km }, error: null }; });
          }
          return { data: null, error: { message: 'Geocoding indisponível' } };
        });
    },

    /* ── Upload Cloudinary (assinado via Edge Function) ── */
    cloudinarySign: function(folder) {
      return _callFn('cloudinary-sign', { folder: folder || 'cardapio' }, true);
    },

    /* ── Realtime subscriptions ── */
    subscribeMenu: function(callback) {
      _subscribe('menu_items', function(payload) {
        Supa.Menu.list().then(function(res) { if (callback) callback(res.data || []); });
      });
    },

    subscribeOrders: function(callback) {
      _subscribe('pedidos', function(payload) {
        Supa.Pedidos.list().then(function(res) { if (callback) callback(res.data || []); });
      });
    },

    subscribeCategories: function(callback) {
      _subscribe('categorias', function(payload) {
        Supa.Categories.list().then(function(res) { if (callback) callback(res.data || []); });
      });
    },

    subscribeLoja: function(callback) {
      _subscribe('lojas', function(payload) {
        Supa.Loja.get().then(function(res) { if (callback) callback(res.data || {}); });
      });
    },

    /* ── Notificar WhatsApp via Edge Function wa-notify ── */
    waNotify: function(type, payload) {
      return _callFn('wa-notify', { type: type, payload: payload }, true);
    },

    /* ── Hidratação inicial ── */
    hydrate: function() {
      _emit('supa:sync', { status: 'loading' });
      return Promise.all([
        Supa.Loja.get(),
        Supa.Menu.list(),
        Supa.Categories.list(),
      ]).then(function() {
        _emit('supa:hydrated', {});
        _emit('supa:sync', { status: 'ok' });
        _rtConnect(); // inicia Realtime após hydrate
      }).catch(function(e) {
        _emit('supa:sync', { status: 'error', message: e.message });
        _emit('supa:hydrated', { offline: true }); // sempre dispara para não travar UI
      });
    },

    /* ── Hidratação admin (inclui pedidos e usuários) ── */
    hydrateAdmin: function() {
      _emit('supa:sync', { status: 'loading' });
      return Supa.Admin.call('get_all').then(function(res) {
        if (res.data) {
          var d = res.data;
          if (d.lojas      && d.lojas[0])   { _cache.set('loja', _mapLoja(d.lojas[0])); }
          if (d.menu_items) {
            var menu = d.menu_items.map(_mapMenuItem);
            _cache.set('menu', menu);
            try { localStorage.setItem('menu_data', JSON.stringify(menu)); } catch(e) {}
            _emit('supa:menu', menu);
          }
          if (d.categorias) {
            _cache.set('categories', d.categorias);
            try { localStorage.setItem('categories', JSON.stringify(d.categorias)); } catch(e) {}
            _emit('supa:categories', d.categorias);
          }
          if (d.pedidos) {
            var orders = d.pedidos.map(_mapOrderFromSupa);
            _cache.set('orders', orders);
            try { localStorage.setItem('orders', JSON.stringify(orders)); } catch(e) {}
            _emit('supa:orders', orders);
          }
          if (d.clientes) {
            try { localStorage.setItem('users_db', JSON.stringify(d.clientes)); } catch(e) {}
          }
        }
        _emit('supa:hydrated', {});
        _emit('supa:sync', { status: 'ok' });
        _rtConnect();
        return res;
      }).catch(function(e) {
        _emit('supa:sync', { status: 'error', message: e.message });
        _emit('supa:hydrated', { offline: true });
      });
    },
  };

  global.Supa = Supa;
  _emit('supa:ready', {});

})(window);
