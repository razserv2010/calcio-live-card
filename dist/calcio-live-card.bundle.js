/**
 * calcio-live-reminders-patch.js
 * 
 * טוען אחרי calcio-live-card.bundle.js
 * מוסיף "תזכר אותי" לכרטיס calcio-live-matches
 * משתמש באותו input_text.calcio_live_reminders
 * 
 * שימוש ב-resources של HA:
 *   - calcio-live-card.bundle.js  (קיים)
 *   - calcio-live-reminders-patch.js  (חדש - זה הקובץ)
 */

(function () {
  'use strict';

  const REMINDERS_ENTITY = 'input_text.calcio_live_reminders';

  // ---- helper: ID ייחודי למשחק ----
  // משתמש ב-home_team + away_team + תאריך (אין fixture_id בכרטיס הזה)
  function matchId(m) {
    return `${m.home_team}__${m.away_team}__${(m.date || '').split(' ')[0]}`;
  }

  function isLiveState(state) {
    return state === 'in';
  }

  function isFinishedState(state) {
    return state === 'post';
  }

  // ---- Toast ----
  function showToast(msg, color) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      background:${color};color:white;
      padding:12px 20px;border-radius:12px;
      font-size:13px;font-weight:600;
      z-index:99999;direction:rtl;text-align:center;
      box-shadow:0 4px 20px rgba(0,0,0,0.3);
      max-width:300px;line-height:1.6;
      white-space:pre-line;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ---- Patch calcio-live-matches ----
  function patchCalcioLiveMatches() {
    const OrigClass = customElements.get('calcio-live-matches');
    if (!OrigClass) return;

    // אל תבצע patch פעמיים
    if (OrigClass._reminderPatched) return;
    OrigClass._reminderPatched = true;

    const proto = OrigClass.prototype;

    // --- שמור את ה-set hass המקורי ---
    const origSetHass = Object.getOwnPropertyDescriptor(proto, 'hass')
      || Object.getOwnPropertyDescriptor(OrigClass.prototype, 'hass');

    // --- אתחול state ---
    const origConnected = proto.connectedCallback;
    proto.connectedCallback = function () {
      this._reminders = this._reminders || new Set();
      origConnected && origConnected.call(this);
    };

    // --- override set hass ---
    const origHassSetter = origSetHass ? origSetHass.set : null;

    Object.defineProperty(proto, 'hass', {
      get: origSetHass ? origSetHass.get : undefined,
      set: function (hass) {
        // קרא ל-setter המקורי
        if (origHassSetter) origHassSetter.call(this, hass);
        else this._hass = hass;

        // טען תזכורות
        const remState = hass.states[REMINDERS_ENTITY]?.state || '';
        this._loadReminders(remState);

        // הסר תזכורות של משחקים שהתחילו / הסתיימו
        this._autoCleanReminders(hass);
      },
      configurable: true,
    });

    // --- _loadReminders ---
    proto._loadReminders = function (state) {
      if (!state || state === 'unknown' || state === 'unavailable' || state === '') {
        this._reminders = new Set();
      } else {
        this._reminders = new Set(state.split(',').map(s => s.trim()).filter(Boolean));
      }
    };

    // --- _autoCleanReminders: מסיר תזכורות כשמשחק עלה LIVE או הסתיים ---
    proto._autoCleanReminders = function (hass) {
      if (!this._reminders || this._reminders.size === 0) return;
      const entity = this._config && this._config.entity;
      if (!entity) return;
      const stateObj = hass.states[entity];
      if (!stateObj) return;
      const matches = stateObj.attributes.matches || [];
      let changed = false;
      matches.forEach(m => {
        const id = matchId(m);
        if (this._reminders.has(id) && (isLiveState(m.state) || isFinishedState(m.state))) {
          this._reminders.delete(id);
          changed = true;
        }
      });
      if (changed) {
        this._persistReminders();
      }
    };

    // --- _persistReminders: שמור ל-HA ---
    proto._persistReminders = function () {
      const hass = this._hass || this.hass;
      if (!hass) return;
      hass.callService('input_text', 'set_value', {
        entity_id: REMINDERS_ENTITY,
        value: Array.from(this._reminders).join(','),
      });
    };

    // --- _toggleReminder ---
    proto._toggleReminder = async function (match, e) {
      e && e.stopPropagation();
      const id = matchId(match);
      const current = new Set(this._reminders);
      if (current.has(id)) {
        current.delete(id);
      } else {
        current.add(id);
      }
      const value = Array.from(current).join(',');
      const hass = this._hass || this.hass;
      if (!hass) return;
      await hass.callService('input_text', 'set_value', {
        entity_id: REMINDERS_ENTITY,
        value,
      });
      this._reminders = current;

      // עדכן כפתור מיידית
      const btn = this.shadowRoot && this.shadowRoot.querySelector(`[data-match-id="${CSS.escape(id)}"]`);
      if (btn) {
        const has = current.has(id);
        btn.textContent = has ? '🔔 תזכורת פעילה' : '🔕 תזכר אותי';
        btn.style.opacity = has ? '1' : '0.6';
      }

      showToast(
        current.has(id)
          ? `🔔 תזכורת נקבעה!\n${match.home_team} נגד ${match.away_team}`
          : `🔕 תזכורת בוטלה\n${match.home_team} נגד ${match.away_team}`,
        current.has(id) ? '#22c55e' : '#ef4444'
      );
    };

    // --- inject כפתורים אחרי כל render ---
    const origUpdated = proto.updated;
    proto.updated = function (changedProps) {
      origUpdated && origUpdated.call(this, changedProps);
      this._injectReminderButtons();
    };

    proto._injectReminderButtons = function () {
      if (!this.shadowRoot) return;
      const reminders = this._reminders || new Set();

      // הוסף CSS אם עדיין לא קיים
      if (!this.shadowRoot.querySelector('#reminder-styles')) {
        const style = document.createElement('style');
        style.id = 'reminder-styles';
        style.textContent = `
          .remind-btn {
            background: rgba(167,139,250,0.12);
            border: 1px solid rgba(167,139,250,0.3);
            color: #a78bfa;
            cursor: pointer;
            font-size: 10px;
            padding: 3px 9px;
            border-radius: 20px;
            transition: all 0.2s;
            margin-top: 4px;
            white-space: nowrap;
            display: inline-block;
          }
          .remind-btn:hover { background: rgba(167,139,250,0.22); }
          .remind-btn:active { transform: scale(0.95); }
        `;
        this.shadowRoot.appendChild(style);
      }

      // מצא את כל שורות המשחקים
      const rows = this.shadowRoot.querySelectorAll('.match-row');
      const entity = this._config && this._config.entity;
      if (!entity) return;
      const hass = this._hass || this.hass;
      if (!hass) return;
      const stateObj = hass.states[entity];
      if (!stateObj) return;
      const matches = stateObj.attributes.matches || [];

      rows.forEach((row, idx) => {
        const match = matches[idx];
        if (!match) return;

        // רק משחקים עתידיים (pre state)
        if (match.state !== 'pre') return;

        // כבר יש כפתור?
        if (row.querySelector('.remind-btn')) {
          // רק עדכן מצב
          const btn = row.querySelector('.remind-btn');
          const id = matchId(match);
          const has = reminders.has(id);
          btn.textContent = has ? '🔔 תזכורת פעילה' : '🔕 תזכר אותי';
          btn.style.opacity = has ? '1' : '0.6';
          return;
        }

        // הוסף כפתור לאזור match-teams
        const teamsDiv = row.querySelector('.match-teams');
        if (!teamsDiv) return;

        const id = matchId(match);
        const has = reminders.has(id);

        const btn = document.createElement('button');
        btn.className = 'remind-btn';
        btn.setAttribute('data-match-id', id);
        btn.textContent = has ? '🔔 תזכורת פעילה' : '🔕 תזכר אותי';
        btn.style.opacity = has ? '1' : '0.6';

        btn.addEventListener('click', (e) => {
          this._toggleReminder(match, e);
        });

        // עטוף ב-div extras כדי לא לשבור layout
        const extrasDiv = document.createElement('div');
        extrasDiv.className = 'row-extras';
        extrasDiv.style.marginTop = '4px';
        extrasDiv.appendChild(btn);
        teamsDiv.appendChild(extrasDiv);
      });
    };

    console.log('[calcio-live-reminders-patch] calcio-live-matches patched ✓');
  }

  // ---- המתן עד ש-customElement יירשם ----
  function waitAndPatch() {
    if (customElements.get('calcio-live-matches')) {
      patchCalcioLiveMatches();
    } else {
      // HA לפעמים רושם אלמנטים מאוחר — נמתין
      const observer = new MutationObserver(() => {
        if (customElements.get('calcio-live-matches')) {
          observer.disconnect();
          patchCalcioLiveMatches();
        }
      });
      observer.observe(document.head, { childList: true, subtree: true });

      // fallback timeout
      setTimeout(() => {
        observer.disconnect();
        patchCalcioLiveMatches();
      }, 5000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndPatch);
  } else {
    waitAndPatch();
  }

})();
