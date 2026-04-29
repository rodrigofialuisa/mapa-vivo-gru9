/**
 * sync-indicator.js — Badge visual de status de sincronização com Supabase
 * Inclua APENAS no admin.html, depois do supabase-adapter.js
 */
(function() {
  'use strict';

  var _states = {
    loading: { color: '#f59e0b', label: '⏳ Sincronizando...',  bg: 'rgba(245,158,11,.12)', bord: 'rgba(245,158,11,.3)' },
    ok:      { color: '#22c55e', label: '✅ Sincronizado',      bg: 'rgba(34,197,94,.1)',   bord: 'rgba(34,197,94,.25)' },
    error:   { color: '#ef4444', label: '🔴 Sem conexão',       bg: 'rgba(239,68,68,.1)',   bord: 'rgba(239,68,68,.25)' },
    offline: { color: '#7c8098', label: '📴 Offline (cache)',   bg: 'rgba(124,128,152,.1)', bord: 'rgba(124,128,152,.25)' },
  };

  var _badge = null;
  var _timeout = null;

  function _ensure() {
    if (_badge) return;
    _badge = document.createElement('div');
    _badge.id = 'sync-badge';
    _badge.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px', 'z-index:9999',
      'border-radius:20px', 'padding:6px 14px',
      'font-size:.74rem', 'font-weight:700',
      'display:flex', 'align-items:center', 'gap:6px',
      'transition:all .25s', 'cursor:default',
      'box-shadow:0 2px 12px rgba(0,0,0,.3)',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(_badge);
  }

  function _set(state) {
    _ensure();
    var s = _states[state] || _states.ok;
    _badge.style.background  = s.bg;
    _badge.style.border      = '1px solid ' + s.bord;
    _badge.style.color       = s.color;
    _badge.textContent       = s.label;
    _badge.style.opacity     = '1';
    _badge.style.transform   = 'translateY(0)';
    /* Auto-esconde após 4s quando ok */
    clearTimeout(_timeout);
    if (state === 'ok') {
      _timeout = setTimeout(function() {
        if (_badge) { _badge.style.opacity = '0'; _badge.style.transform = 'translateY(8px)'; }
      }, 4000);
    }
  }

  /* Ouve eventos do adapter */
  window.addEventListener('supa:sync', function(e) {
    var d = e.detail || {};
    if (d.status === 'loading') _set('loading');
    else if (d.status === 'ok') _set('ok');
    else if (d.status === 'error') _set('error');
  });

  window.addEventListener('supa:hydrated', function(e) {
    var d = e.detail || {};
    _set(d.offline ? 'offline' : 'ok');
  });

  /* Detecta mudança de conectividade */
  window.addEventListener('online',  function() { _set('ok'); });
  window.addEventListener('offline', function() { _set('offline'); });

  /* Expõe para uso manual */
  window.SyncIndicator = { set: _set };

})();
