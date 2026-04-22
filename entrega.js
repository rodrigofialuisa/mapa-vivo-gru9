/**
 * ══════════════════════════════════════════════════════════
 *  RAPI10 DELIVERY ENGINE  —  entrega.js  v1.0
 *  Sistema de entrega por distância com cálculo de zonas
 *  Integra com cardapio.html e admin.html
 *  Fallback automático: Nominatim → Haversine (sem API key)
 * ══════════════════════════════════════════════════════════
 */

/* ──────────────────────────────────────────────────────────
   CONSTANTE GLOBAL — endereço de origem (loja)
────────────────────────────────────────────────────────── */
var ORIGEM_LOJA = 'Rua Azevedo Marques 289, Jardim Professor, Francisco Morato - SP';

/* ──────────────────────────────────────────────────────────
   COORDENADAS FIXAS DA LOJA (pré-calculadas, sem API)
   Usadas como fallback quando geocodificação falha
   Francisco Morato — SP
────────────────────────────────────────────────────────── */
var LOJA_COORDS = { lat: -23.2795, lng: -46.7428 };

/* ──────────────────────────────────────────────────────────
   CONFIGURAÇÃO DAS ZONAS
   Editável via CFG (store_config no localStorage) ou admin
────────────────────────────────────────────────────────── */
var DELIVERY_CONFIG_DEFAULTS = {
  /* Zona 1 — Bairro */
  zona1_km:    1,          // até X km
  zona1_taxa:  2,          // R$
  zona1_tempo: '10–20 min',
  zona1_label: 'Entrega rápida no bairro 🚀',
  zona1_metodo:'propria',

  /* Zona 2 — Motoboy */
  zona2_km:    3,          // até X km
  zona2_base:  5,          // R$ base
  zona2_pkm:   2,          // R$ por km
  zona2_tempo: '20–40 min',
  zona2_label: 'Entrega via motoboy 🏍️',
  zona2_metodo:'motoboy',
  zona2_minimo:20,         // pedido mínimo em R$

  /* Zona 3 — Fora */
  zona3_msg:   'Atendemos apenas esta região no momento 🙏\nVocê pode nos encontrar no iFood 👍',

  /* Google Maps API key (opcional) */
  gmaps_key: '',
};

/* ──────────────────────────────────────────────────────────
   HELPERS INTERNOS
────────────────────────────────────────────────────────── */

/** Cache de config (invalida a cada 30s para pegar mudanças do admin) */
var _cfgCache = null;
var _cfgCacheTs = 0;
function _deliveryConfig() {
  var now = Date.now();
  if (_cfgCache && now - _cfgCacheTs < 30000) return _cfgCache;
  try {
    var c = JSON.parse(localStorage.getItem('store_config') || '{}');
    _cfgCache = Object.assign({}, DELIVERY_CONFIG_DEFAULTS, c.delivery || {});
    // Sync LOJA_COORDS if custom origin is stored
    if (c.deliveryOrigin) window.ORIGEM_LOJA = c.deliveryOrigin;
    _cfgCacheTs = now;
    return _cfgCache;
  } catch(e) {
    return Object.assign({}, DELIVERY_CONFIG_DEFAULTS);
  }
}

/** Cache de geocoding (endereço → coordenadas) — evita requests repetidos */
var _geoCache = {};

/** Haversine — distância em km entre dois pontos lat/lng */
function _haversine(lat1, lng1, lat2, lng2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
        * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Normaliza endereço para uso como cache key */
function _normAddr(addr) {
  return addr.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Geocodifica endereço via Nominatim (gratuito, sem key) */
function _geocodeNominatim(address) {
  var key = _normAddr(address);
  if (_geoCache[key]) return Promise.resolve(_geoCache[key]);

  return new Promise(function(resolve, reject) {
    var q = encodeURIComponent(address + ', Brasil');
    var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + q;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    // User-Agent obrigatório pela política de uso do Nominatim
    xhr.setRequestHeader('Accept-Language', 'pt-BR');
    // Não podemos setar User-Agent no browser (header restrito), mas adicionamos Referer
    xhr.setRequestHeader('Referer', window.location.origin || 'https://cardapio.app');
    xhr.timeout = 8000;
    xhr.onload = function() {
      try {
        var data = JSON.parse(xhr.responseText);
        if (data && data.length > 0) {
          var coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
          _geoCache[key] = coords; // cache result
          resolve(coords);
        } else {
          reject(new Error('Endereço não encontrado'));
        }
      } catch(e) { reject(e); }
    };
    xhr.onerror = xhr.ontimeout = function() { reject(new Error('Erro de rede / timeout')); };
    xhr.send();
  });
}

/** Geocodifica via Google Maps (quando key disponível) */
function _geocodeGoogle(address, key) {
  var cacheKey = _normAddr(address) + '_gmaps';
  if (_geoCache[cacheKey]) return Promise.resolve(_geoCache[cacheKey]);

  return new Promise(function(resolve, reject) {
    var q = encodeURIComponent(address);
    var url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + q + '&key=' + key;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.timeout = 8000;
    xhr.onload = function() {
      try {
        var data = JSON.parse(xhr.responseText);
        if (data.status === 'OK' && data.results.length > 0) {
          var loc = data.results[0].geometry.location;
          var coords = { lat: loc.lat, lng: loc.lng };
          _geoCache[cacheKey] = coords;
          resolve(coords);
        } else {
          reject(new Error('Google Geocode: ' + data.status));
        }
      } catch(e) { reject(e); }
    };
    xhr.onerror = xhr.ontimeout = function() { reject(new Error('Erro de rede')); };
    xhr.send();
  });
}

/** Distância via Google Distance Matrix (quando key disponível) */
function _distanceMatrix(origem, destino, key) {
  return new Promise(function(resolve, reject) {
    var o = encodeURIComponent(origem);
    var d = encodeURIComponent(destino);
    var url = 'https://maps.googleapis.com/maps/api/distancematrix/json'
            + '?origins=' + o + '&destinations=' + d
            + '&mode=driving&units=metric&language=pt-BR&key=' + key;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.timeout = 10000;
    xhr.onload = function() {
      try {
        var data = JSON.parse(xhr.responseText);
        if (data.status === 'OK'
            && data.rows[0].elements[0].status === 'OK') {
          var meters = data.rows[0].elements[0].distance.value;
          resolve(meters / 1000); // km
        } else {
          reject(new Error('Distance Matrix: ' + (data.status || 'ELEMENT_' + data.rows[0].elements[0].status)));
        }
      } catch(e) { reject(e); }
    };
    xhr.onerror = xhr.ontimeout = function() { reject(new Error('Erro de rede')); };
    xhr.send();
  });
}

/* ══════════════════════════════════════════════════════════
   DELIVERY ENGINE — API PÚBLICA
══════════════════════════════════════════════════════════ */
var DeliveryEngine = {

  /* ── Regra de negócio pura (sem I/O) ── */
  calcularEntrega: function(distanciaKm) {
    var cfg = _deliveryConfig();
    var km  = parseFloat(distanciaKm) || 0;

    if (km <= cfg.zona1_km) {
      return {
        zona:     'bairro',
        label:    cfg.zona1_label,
        taxa:     cfg.zona1_taxa,
        metodo:   cfg.zona1_metodo,
        tempo:    cfg.zona1_tempo,
        minimo:   0,
        bloqueado: false,
        distancia: km,
        cor:      '#22c55e',
        emoji:    '🟢',
      };
    }

    if (km <= cfg.zona2_km) {
      var taxa = cfg.zona2_base + (km * cfg.zona2_pkm);
      return {
        zona:     'proximo',
        label:    cfg.zona2_label,
        taxa:     parseFloat(taxa.toFixed(2)),
        metodo:   cfg.zona2_metodo,
        tempo:    cfg.zona2_tempo,
        minimo:   cfg.zona2_minimo,
        bloqueado: false,
        distancia: km,
        cor:      '#f59e0b',
        emoji:    '🟡',
      };
    }

    return {
      zona:      'fora',
      label:     'Fora da área de entrega',
      taxa:      0,
      metodo:    null,
      tempo:     null,
      minimo:    0,
      bloqueado:  true,
      distancia:  km,
      msg:        cfg.zona3_msg,
      cor:        '#ef4444',
      emoji:      '🔴',
    };
  },

  /* ── Calcula distância em km dado um endereço de destino ── */
  calcularDistancia: function(enderecoDestino) {
    var cfg = _deliveryConfig();
    var key = cfg.gmaps_key;

    /* 1) Google Distance Matrix (mais preciso — rota real) */
    if (key) {
      return _distanceMatrix(ORIGEM_LOJA, enderecoDestino, key)
        .catch(function() {
          /* fallback para geocode + haversine se DM falhar */
          return DeliveryEngine._fallbackGeocode(enderecoDestino, key);
        });
    }

    /* 2) Nominatim + Haversine (gratuito, linha reta) */
    return DeliveryEngine._fallbackGeocode(enderecoDestino, null);
  },

  _fallbackGeocode: function(enderecoDestino, key) {
    var geocodeFn = key
      ? function() { return _geocodeGoogle(enderecoDestino, key); }
      : function() { return _geocodeNominatim(enderecoDestino); };

    return geocodeFn().then(function(coords) {
      var km = _haversine(
        LOJA_COORDS.lat, LOJA_COORDS.lng,
        coords.lat,      coords.lng
      );
      /* +20% p/ compensar desvios de rota vs linha reta */
      return parseFloat((km * 1.2).toFixed(2));
    });
  },

  /* ── Limpa cache de config (chamar ao salvar settings no admin) ── */
  invalidarCache: function() {
    _cfgCache    = null;
    _cfgCacheTs  = 0;
    _geoCache    = {};
  },

  /* ── Calcula + decide zona em uma chamada — com retry automático ── */
  analisarEntrega: function(enderecoDestino, onSuccess, onError, onLoading) {
    if (onLoading) onLoading(true);

    // Sanitiza e valida entrada
    var dest = String(enderecoDestino || '').replace(/\s+/g, ' ').trim();
    if (!dest || dest.length < 8) {
      if (onLoading) onLoading(false);
      if (onError) onError(new Error('Endereço muito curto ou vazio'));
      return;
    }

    // Se destino coincide com a própria loja (cliente buscar retirar)
    var originNorm = _normAddr(window.ORIGEM_LOJA || ORIGEM_LOJA);
    var destNorm   = _normAddr(dest);
    if (destNorm === originNorm) {
      if (onLoading) onLoading(false);
      if (onSuccess) onSuccess(Object.assign(DeliveryEngine.calcularEntrega(0), { _selfPickup: true }));
      return;
    }

    var attempts = 0;
    var maxAttempts = 2;

    function tryCalc() {
      attempts++;
      DeliveryEngine.calcularDistancia(dest)
        .then(function(km) {
          var resultado = DeliveryEngine.calcularEntrega(km);
          if (onLoading) onLoading(false);
          if (onSuccess) onSuccess(resultado);
        })
        .catch(function(err) {
          if (attempts < maxAttempts) {
            setTimeout(tryCalc, 1000);
            return;
          }
          if (onLoading) onLoading(false);
          if (onError) onError(err);
        });
    }
    tryCalc();
  },

  /* ── Valida pedido antes de enviar ── */
  validarPedido: function(resultado, subtotal) {
    if (!resultado) return { ok: false, msg: 'Calcule o frete antes de continuar.' };
    if (resultado.bloqueado) {
      return { ok: false, msg: resultado.msg || 'Endereço fora da área de entrega.' };
    }
    if (resultado.minimo > 0 && subtotal < resultado.minimo) {
      return {
        ok:  false,
        msg: 'Pedido mínimo para entrega via motoboy: R$ '
           + resultado.minimo.toFixed(2).replace('.', ',')
           + '. Faltam R$ '
           + (resultado.minimo - subtotal).toFixed(2).replace('.', ',') + '.',
      };
    }
    return { ok: true };
  },

  /* ── Salva / recupera resultado no sessionStorage ── */
  salvar: function(resultado) {
    try { sessionStorage.setItem('delivery_result', JSON.stringify(resultado)); } catch(e) {}
  },
  recuperar: function() {
    try {
      var s = sessionStorage.getItem('delivery_result');
      return s ? JSON.parse(s) : null;
    } catch(e) { return null; }
  },
  limpar: function() {
    try { sessionStorage.removeItem('delivery_result'); } catch(e) {}
  },
};

/* ══════════════════════════════════════════════════════════
   DELIVERY UI — componentes visuais reutilizáveis
══════════════════════════════════════════════════════════ */
var DeliveryUI = {

  /* Badge de zona para tabela de pedidos no admin */
  zonaBadge: function(zona, distancia) {
    var map = {
      bairro:  { emoji:'🟢', label:'Bairro',  bg:'rgba(34,197,94,.12)',  color:'#22c55e' },
      proximo: { emoji:'🟡', label:'Motoboy', bg:'rgba(245,158,11,.12)', color:'#f59e0b' },
      fora:    { emoji:'🔴', label:'Fora',    bg:'rgba(239,68,68,.12)',  color:'#ef4444' },
    };
    var z = map[zona] || map.fora;
    var km = distancia ? ' · ' + parseFloat(distancia).toFixed(1) + 'km' : '';
    return '<span style="display:inline-flex;align-items:center;gap:4px;border-radius:20px;padding:3px 9px;font-size:.69rem;font-weight:700;background:' + z.bg + ';color:' + z.color + '">'
         + z.emoji + ' ' + z.label + km + '</span>';
  },

  /* Card de entrega para o checkout (cardápio) */
  cartaoEntregaHTML: function(resultado, loading) {
    if (loading) {
      return '<div style="display:flex;align-items:center;gap:9px;padding:12px 14px;background:var(--s2);border:1px solid var(--bord);border-radius:12px;font-size:.84rem;color:var(--t2)">'
           + '<span style="animation:spin 1s linear infinite;display:inline-block;font-size:1.1rem">⏳</span>'
           + 'Calculando distância...'
           + '</div>';
    }

    if (!resultado) {
      return '<div style="padding:11px 14px;background:var(--s2);border:1px solid var(--bord);border-radius:12px;font-size:.82rem;color:var(--muted)">'
           + '📍 Informe o endereço para calcular o frete'
           + '</div>';
    }

    if (resultado.bloqueado) {
      return '<div style="padding:13px 15px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-radius:12px">'
           + '<div style="font-weight:700;color:#f87171;margin-bottom:5px;font-size:.88rem">🔴 Fora da área de entrega</div>'
           + '<div style="font-size:.81rem;color:var(--t2);white-space:pre-line;line-height:1.55">' + (resultado.msg || '') + '</div>'
           + '</div>';
    }

    var cor   = resultado.cor || '#22c55e';
    var fmtTaxa = 'R$ ' + parseFloat(resultado.taxa || 0).toFixed(2).replace('.', ',');
    var fmtDist = resultado.distancia ? parseFloat(resultado.distancia).toFixed(1) + ' km' : '';
    var bgAlpha = resultado.zona === 'bairro'  ? 'rgba(34,197,94,.07)'
                : resultado.zona === 'proximo' ? 'rgba(245,158,11,.07)'
                : 'rgba(239,68,68,.07)';
    var brdAlpha = resultado.zona === 'bairro'  ? 'rgba(34,197,94,.25)'
                 : resultado.zona === 'proximo' ? 'rgba(245,158,11,.25)'
                 : 'rgba(239,68,68,.25)';

    return '<div style="padding:12px 14px;background:' + bgAlpha + ';border:1px solid ' + brdAlpha + ';border-radius:12px">'
         + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
           + '<div style="font-weight:700;font-size:.88rem;color:' + cor + '">' + resultado.emoji + ' ' + resultado.label + '</div>'
           + '<div style="font-family:var(--serif,serif);font-size:1.05rem;font-weight:900;color:' + cor + '">' + fmtTaxa + '</div>'
         + '</div>'
         + '<div style="display:flex;gap:14px">'
           + '<div style="font-size:.76rem;color:var(--t2)">⏱️ ' + resultado.tempo + '</div>'
           + (fmtDist ? '<div style="font-size:.76rem;color:var(--t2)">📏 ' + fmtDist + '</div>' : '')
           + (resultado.metodo === 'motoboy' ? '<div style="font-size:.76rem;color:var(--t2)">🏍️ via 99</div>' : '')
         + '</div>'
         + (resultado.minimo > 0 ? '<div style="font-size:.74rem;color:var(--muted);margin-top:5px">Pedido mínimo: R$ ' + resultado.minimo.toFixed(2).replace('.', ',') + '</div>' : '')
         + '</div>';
  },

  /* Linha resumida para tabela do admin */
  resumoAdmin: function(pedido) {
    if (!pedido.deliveryZona) return '—';
    return DeliveryUI.zonaBadge(pedido.deliveryZona, pedido.deliveryDistancia);
  },
};

/* ── CSS de animação spin (injetado com segurança após DOM ready) ── */
function _injectSpinCSS() {
  if (document.getElementById('delivery-spin-css')) return;
  var s = document.createElement('style');
  s.id  = 'delivery-spin-css';
  s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
  (document.head || document.documentElement).appendChild(s);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _injectSpinCSS);
} else {
  _injectSpinCSS();
}

/* ── Exporta globalmente ── */
if (typeof window !== 'undefined') {
  window.ORIGEM_LOJA    = ORIGEM_LOJA;
  window.LOJA_COORDS    = LOJA_COORDS;
  window.DeliveryEngine = DeliveryEngine;
  window.DeliveryUI     = DeliveryUI;
}
