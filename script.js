/* ==========================================================================
   Aroma Coffee — script.js
   Ванильный ES6+, без зависимостей. Каждый модуль изолирован и обёрнут
   в safe(): ошибка в одном не ломает остальные.
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     Конфигурация
     ------------------------------------------------------------------------ */
  const CONFIG = {
    timeZone: 'Etc/GMT-5',                 // Астана, UTC+5 (без перехода на летнее время)
    hours: {                               // часы работы, минуты от полуночи
      weekday: [8 * 60, 22 * 60],          // Пн–Пт 08:00–22:00
      weekend: [9 * 60, 23 * 60],          // Сб–Вс 09:00–23:00
    },
    booking: {
      stepSec: 15 * 60,                    // шаг времени — 15 минут
      lastSlotBeforeCloseMin: 60,          // последняя бронь за час до закрытия
      leadTimeMin: 30,                     // минимум за 30 минут до визита
      horizonDays: 60,                     // горизонт бронирования
      endpoint: null,                      // например '/api/booking'; null — имитация отправки
      timeoutMs: 10000,
    },
    toastMs: 5000,
  };

  /* ------------------------------------------------------------------------
     Утилиты
     ------------------------------------------------------------------------ */
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const pad = (n) => String(n).padStart(2, '0');
  const fmtMinutes = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

  const rafThrottle = (fn) => {
    let ticking = false;
    return (...args) => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        fn(...args);
      });
    };
  };

  const prefersReducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Время «в кофейне» (Астана), независимо от часового пояса устройства. */
  const getShopNow = () => {
    let parts;
    try {
      parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: CONFIG.timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date());
    } catch {
      parts = null; // фолбэк: время устройства
    }

    const read = (type, fallback) => {
      const value = Number(parts?.find((p) => p.type === type)?.value);
      return Number.isFinite(value) ? value : fallback;
    };

    const d = new Date();
    const y = read('year', d.getFullYear());
    const m = read('month', d.getMonth() + 1);
    const day = read('day', d.getDate());
    const minutes = read('hour', d.getHours()) * 60 + read('minute', d.getMinutes());

    return {
      y, m, d: day, minutes,
      dow: new Date(y, m - 1, day).getDay(),
      iso: `${y}-${pad(m)}-${pad(day)}`,
    };
  };

  const hoursFor = (dow) => (dow === 0 || dow === 6 ? CONFIG.hours.weekend : CONFIG.hours.weekday);

  const isoFromDate = (date) =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  const parseIsoDate = (iso) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!match) return null;
    const [, y, m, d] = match.map(Number);
    const date = new Date(y, m - 1, d);
    return date.getMonth() === m - 1 ? date : null;
  };

  const parseTime = (value) => {
    const match = /^(\d{2}):(\d{2})$/.exec(value || '');
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };

  /* ------------------------------------------------------------------------
     Изображения: lazy, fallback при ошибке загрузки
     ------------------------------------------------------------------------ */
  const initImages = () => {
    $$('img').forEach((img) => {
      if (img.closest('.hero')) {
        img.fetchPriority = 'high';
      } else {
        img.loading = 'lazy';
        img.decoding = 'async';
      }

      const markBroken = () => img.parentElement?.classList.add('is-broken');
      img.addEventListener('error', markBroken, { once: true });
      if (img.complete && img.naturalWidth === 0 && img.currentSrc) markBroken();
    });
  };

  /* ------------------------------------------------------------------------
     Шапка: стеклянный фон после прокрутки
     ------------------------------------------------------------------------ */
  const initHeader = () => {
    const header = $('#header');
    if (!header) return;

    const update = () => header.classList.toggle('is-scrolled', window.scrollY > 24);
    window.addEventListener('scroll', rafThrottle(update), { passive: true });
    update();
  };

  /* ------------------------------------------------------------------------
     Мобильное меню
     ------------------------------------------------------------------------ */
  const initNav = () => {
    const header = $('#header');
    const nav = $('#nav');
    const burger = $('#burger');
    if (!header || !nav || !burger) return;

    const links = $$('.nav__link', nav);
    links.forEach((link, i) => link.style.setProperty('--i', i));

    // CTA для мобильной панели: клонируем кнопку из шапки
    const headerCta = $('.header__btn', header);
    if (headerCta && !$('.nav__cta', nav)) {
      const cta = headerCta.cloneNode(true);
      cta.classList.remove('header__btn');
      cta.classList.add('nav__cta');
      cta.style.setProperty('--i', links.length);
      nav.append(cta);
    }

    burger.setAttribute('aria-controls', 'nav');
    burger.setAttribute('aria-expanded', 'false');

    const desktop = window.matchMedia('(min-width: 64rem)');
    let isOpen = false;

    const setOpen = (open, { restoreFocus = false } = {}) => {
      if (open === isOpen) return;
      isOpen = open;
      nav.classList.toggle('is-open', open);
      burger.classList.toggle('is-open', open);
      header.classList.toggle('is-menu-open', open);
      document.documentElement.classList.toggle('no-scroll', open);
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
      if (!open && restoreFocus) burger.focus();
    };

    burger.addEventListener('click', () => setOpen(!isOpen));

    nav.addEventListener('click', (e) => {
      if (e.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', (e) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        setOpen(false, { restoreFocus: true });
        return;
      }

      // Фокус-ловушка внутри открытой панели
      if (e.key === 'Tab') {
        const focusable = $$('a[href], button', header)
          .filter((el) => el.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    // Переход на десктопную ширину при открытом меню — закрываем и снимаем блокировку скролла
    const onBreakpoint = (e) => { if (e.matches) setOpen(false); };
    desktop.addEventListener?.('change', onBreakpoint);
  };

  /* ------------------------------------------------------------------------
     Scroll-spy: подсветка активного пункта меню
     ------------------------------------------------------------------------ */
  const initScrollSpy = () => {
    const links = $$('.nav__link');
    if (!links.length || !('IntersectionObserver' in window)) return;

    const byId = new Map(
      links.map((link) => [link.getAttribute('href')?.replace('#', ''), link])
    );
    const sections = $$('section[id]');

    const setActive = (id) => {
      links.forEach((link) => {
        const active = byId.get(id) === link;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { rootMargin: '-45% 0px -50% 0px' }
    );

    sections.forEach((section) => observer.observe(section));
  };

  /* ------------------------------------------------------------------------
     Статус «Открыто сейчас» в hero
     ------------------------------------------------------------------------ */
  const initOpenStatus = () => {
    const content = $('.hero__content');
    const title = $('.hero__title');
    if (!content || !title) return;

    const badge = document.createElement('p');
    badge.className = 'hero__status';
    content.insertBefore(badge, title);

    const render = () => {
      const now = getShopNow();
      const [open, close] = hoursFor(now.dow);

      if (now.minutes >= open && now.minutes < close) {
        badge.dataset.state = 'open';
        badge.textContent = `Открыто до ${fmtMinutes(close)}`;
        return;
      }

      const beforeOpening = now.minutes < open;
      const nextDow = beforeOpening ? now.dow : (now.dow + 1) % 7;
      const [nextOpen] = hoursFor(nextDow);
      badge.dataset.state = 'closed';
      badge.textContent = `Сейчас закрыто, откроемся ${beforeOpening ? 'сегодня' : 'завтра'} в ${fmtMinutes(nextOpen)}`;
    };

    render();
    setInterval(render, 60_000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) render();
    });
  };

  /* ------------------------------------------------------------------------
     Меню: табы с фильтрацией и скользящим индикатором
     ------------------------------------------------------------------------ */
  const initMenuTabs = () => {
    const tabsEl = $('.menu__tabs');
    const cards = $$('.menu-card');
    if (!tabsEl || !cards.length) return;

    const tabs = $$('.menu__tab', tabsEl);
    if (!tabs.length) return;

    tabsEl.setAttribute('role', 'group');
    tabsEl.setAttribute('aria-label', 'Категории меню');

    const activeTab = () => tabs.find((tab) => tab.classList.contains('active')) ?? tabs[0];

    const placeIndicator = (tab) => {
      tabsEl.style.setProperty('--ind-x', `${tab.offsetLeft}px`);
      tabsEl.style.setProperty('--ind-w', `${tab.offsetWidth}px`);
      tabsEl.classList.add('has-indicator');
    };

    const scrollTabIntoView = (tab, smooth) => {
      const target = tab.offsetLeft - (tabsEl.clientWidth - tab.offsetWidth) / 2;
      tabsEl.scrollTo({
        left: Math.max(0, target),
        behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
      });
    };

    const applyFilter = (category, animate) => {
      let index = 0;
      cards.forEach((card) => {
        const match = card.dataset.category === category;
        card.classList.toggle('hidden', !match);
        card.classList.remove('is-entering');
        if (match && animate) {
          card.style.setProperty('--i', index++);
          void card.offsetWidth; // перезапуск CSS-анимации
          card.classList.add('is-entering');
        }
      });
    };

    const select = (tab, { animate }) => {
      tabs.forEach((t) => {
        const isActive = t === tab;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-pressed', String(isActive));
      });
      applyFilter(tab.dataset.category, animate);
      placeIndicator(tab);
      scrollTabIntoView(tab, animate);
    };

    tabsEl.addEventListener('click', (e) => {
      const tab = e.target.closest('.menu__tab');
      if (!tab || tab.classList.contains('active')) return;
      select(tab, { animate: true });
    });

    // Первичная отрисовка без анимации индикатора
    tabsEl.classList.add('is-init');
    select(activeTab(), { animate: false });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => tabsEl.classList.remove('is-init'))
    );

    // Пересчёт при изменении размеров и после загрузки шрифтов
    const refresh = () => {
      tabsEl.classList.add('is-init');
      placeIndicator(activeTab());
      requestAnimationFrame(() => tabsEl.classList.remove('is-init'));
    };
    if ('ResizeObserver' in window) new ResizeObserver(refresh).observe(tabsEl);
    document.fonts?.ready.then(refresh);
  };

  /* ------------------------------------------------------------------------
     Появление при скролле (один раз, без дёрганья)
     ------------------------------------------------------------------------ */
  const initReveal = () => {
    if (!('IntersectionObserver' in window) || prefersReducedMotion()) return;

    const targets = $$([
      '.section__header',
      '.about__content',
      '.about__image',
      '.gallery__item',
      '.review-card',
      '.contacts__info',
      '.contacts__map',
      '.booking-form',
    ].join(','));
    if (!targets.length) return;

    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );

    document.documentElement.classList.add('has-reveal');
    targets.forEach((el) => {
      el.setAttribute('data-reveal', '');
      const siblingIndex = el.parentElement ? [...el.parentElement.children].indexOf(el) : 0;
      el.style.setProperty('--d', `${(siblingIndex % 4) * 80}ms`);
      observer.observe(el);
    });
  };

  /* ------------------------------------------------------------------------
     Тост
     ------------------------------------------------------------------------ */
  const createToast = () => {
    const el = $('#toast');
    const text = el && $('span', el);
    if (!el || !text) return { show() {} };

    const successText = text.textContent.trim();
    let timer;

    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    return {
      show(message, type = 'success') {
        clearTimeout(timer);
        text.textContent = message ?? successText;
        el.classList.toggle('toast--error', type === 'error');
        el.classList.add('is-visible');
        timer = setTimeout(() => el.classList.remove('is-visible'), CONFIG.toastMs);
      },
      successText,
    };
  };

  /* ------------------------------------------------------------------------
     Форма бронирования
     ------------------------------------------------------------------------ */
  const initBookingForm = () => {
    const form = $('#bookingForm');
    if (!form) return;

    const toast = createToast();
    const fields = {
      name: $('#name', form),
      phone: $('#phone', form),
      date: $('#date', form),
      time: $('#time', form),
      guests: $('#guests', form),
    };
    if (Object.values(fields).some((f) => !f)) return;

    const submitBtn = $('button[type="submit"]', form);
    const touched = new Set();
    let submitting = false;

    form.noValidate = true; // используем собственные сообщения
    fields.name.autocomplete = 'name';
    fields.phone.autocomplete = 'tel';
    fields.phone.inputMode = 'tel';
    fields.phone.maxLength = 18;

    /* ---- Даты и время ---- */
    const applyDateBounds = () => {
      const now = getShopNow();
      const max = new Date(now.y, now.m - 1, now.d + CONFIG.booking.horizonDays);
      fields.date.min = now.iso;
      fields.date.max = isoFromDate(max);
    };

    const applyTimeBounds = () => {
      const date = parseIsoDate(fields.date.value);
      const dow = date ? date.getDay() : getShopNow().dow;
      const [open, close] = hoursFor(dow);
      fields.time.min = fmtMinutes(open);
      fields.time.max = fmtMinutes(close - CONFIG.booking.lastSlotBeforeCloseMin);
      fields.time.step = String(CONFIG.booking.stepSec);
    };

    applyDateBounds();
    applyTimeBounds();

    /* ---- Маска телефона: +7 (XXX) XXX-XX-XX ---- */
    const toNational = (raw) => {
      let digits = raw.replace(/\D/g, '');
      if (raw.trim().startsWith('+7')) digits = digits.slice(1);
      else if (digits.length > 10 && (digits[0] === '7' || digits[0] === '8')) digits = digits.slice(1);
      return digits.slice(0, 10);
    };

    const formatPhone = (n) => {
      let out = `+7 (${n.slice(0, 3)}`;
      if (n.length > 3) out += `) ${n.slice(3, 6)}`;
      if (n.length > 6) out += `-${n.slice(6, 8)}`;
      if (n.length > 8) out += `-${n.slice(8, 10)}`;
      return out;
    };

    fields.phone.addEventListener('input', (e) => {
      const input = e.target;
      const raw = input.value;
      const caret = input.selectionStart ?? raw.length;
      const atEnd = caret >= raw.length;
      const national = toNational(raw);

      if (!national) {
        // «8» или «+7» без цифр: оставляем префикс; удаление до пустоты — очищает поле
        const typed = e.inputType?.startsWith('insert') && /\d/.test(raw);
        input.value = typed ? '+7 (' : '';
        return;
      }

      const formatted = formatPhone(national);
      input.value = formatted;

      if (!atEnd) {
        // Сохраняем позицию курсора относительно цифр
        const digitsLeft = raw.slice(0, caret).replace(/\D/g, '').length
          - (raw.trim().startsWith('+7') && caret > 0 ? 1 : 0);
        let pos = formatted.indexOf('(') + 1;
        if (digitsLeft > 0) {
          let seen = 0;
          pos = formatted.length;
          for (let i = 0; i < formatted.length; i += 1) {
            if (/\d/.test(formatted[i])) seen += 1;
            if (seen === digitsLeft + 1) { pos = i + 1; break; }
          }
        }
        input.setSelectionRange(pos, pos);
      }
    });

    // Backspace через символы форматирования удаляет ближайшую цифру
    fields.phone.addEventListener('keydown', (e) => {
      if (e.key !== 'Backspace') return;
      const input = e.target;
      if (input.selectionStart !== input.selectionEnd) return;
      let pos = input.selectionStart;
      while (pos > 0 && !/\d/.test(input.value[pos - 1])) pos -= 1;
      if (pos !== input.selectionStart) input.setSelectionRange(pos, pos);
    });

    /* ---- Валидаторы ---- */
    const validators = {
      name(value) {
        const v = value.trim();
        if (!v) return 'Укажите имя';
        if (v.length < 2) return 'Имя слишком короткое';
        if (!/^\p{L}[\p{L}\s'’.-]*$/u.test(v)) return 'Используйте только буквы';
        return '';
      },

      phone(value) {
        if (!value.trim()) return 'Укажите телефон';
        if (toNational(value).length < 10) return 'Введите номер полностью: 10 цифр после +7';
        return '';
      },

      date(value) {
        if (fields.date.validity.badInput) return 'Введите корректную дату';
        if (!value) return 'Выберите дату';
        const now = getShopNow();
        if (!parseIsoDate(value)) return 'Введите корректную дату';
        if (value < now.iso) return 'Эта дата уже прошла';
        if (value > fields.date.max) {
          return `Бронь доступна на ${CONFIG.booking.horizonDays} дней вперёд`;
        }
        return '';
      },

      time(value) {
        if (fields.time.validity.badInput) return 'Введите корректное время';
        const minutes = parseTime(value);
        if (minutes === null) return 'Выберите время';

        const date = parseIsoDate(fields.date.value);
        if (!date) return '';

        const [open, close] = hoursFor(date.getDay());
        const last = close - CONFIG.booking.lastSlotBeforeCloseMin;
        if (minutes < open || minutes > last) {
          return `В этот день мы работаем с ${fmtMinutes(open)} до ${fmtMinutes(close)}. Последняя бронь — на ${fmtMinutes(last)}`;
        }

        const now = getShopNow();
        if (fields.date.value === now.iso && minutes < now.minutes + CONFIG.booking.leadTimeMin) {
          return `Выберите время минимум через ${CONFIG.booking.leadTimeMin} минут`;
        }
        return '';
      },

      guests(value) {
        const n = Number(value);
        return Number.isInteger(n) && n >= 1 && n <= 6 ? '' : 'Выберите количество гостей';
      },
    };

    /* ---- Отображение ошибок ---- */
    const showError = (input, message) => {
      const group = input.closest('.form-group');
      if (!group) return;

      let error = $('.form-error', group);
      if (!error) {
        error = document.createElement('p');
        error.className = 'form-error';
        error.id = `${input.id}-error`;
        error.hidden = true;
        group.append(error);
      }

      error.textContent = message;
      error.hidden = !message;
      group.classList.toggle('is-invalid', Boolean(message));
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
      if (message) input.setAttribute('aria-describedby', error.id);
      else input.removeAttribute('aria-describedby');
    };

    const validateField = (key) => {
      const message = validators[key](fields[key].value);
      showError(fields[key], message);
      return !message;
    };

    Object.entries(fields).forEach(([key, input]) => {
      input.addEventListener('blur', () => {
        touched.add(key);
        validateField(key);
      });

      const revalidate = () => { if (touched.has(key)) validateField(key); };
      input.addEventListener('input', revalidate);
      input.addEventListener('change', revalidate);
    });

    fields.date.addEventListener('change', () => {
      applyTimeBounds();
      if (touched.has('time') || fields.time.value) validateField('time');
    });

    /* ---- Отправка ---- */
    const sendBooking = async (payload) => {
      const { endpoint, timeoutMs } = CONFIG.booking;
      if (!endpoint) {
        await new Promise((resolve) => setTimeout(resolve, 900)); // имитация сети
        return;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } finally {
        clearTimeout(timer);
      }
    };

    const setLoading = (loading) => {
      submitting = loading;
      if (!submitBtn) return;
      submitBtn.classList.toggle('is-loading', loading);
      submitBtn.disabled = loading;
      submitBtn.setAttribute('aria-busy', String(loading));
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitting) return;

      const keys = Object.keys(fields);
      keys.forEach((key) => touched.add(key));
      const results = keys.map((key) => [key, validateField(key)]);
      const firstInvalid = results.find(([, ok]) => !ok);
      if (firstInvalid) {
        fields[firstInvalid[0]].focus();
        return;
      }

      const payload = {
        name: fields.name.value.trim(),
        phone: formatPhone(toNational(fields.phone.value)),
        date: fields.date.value,
        time: fields.time.value,
        guests: Number(fields.guests.value),
      };

      setLoading(true);
      try {
        await sendBooking(payload);
        form.reset();
        touched.clear();
        Object.values(fields).forEach((input) => showError(input, ''));
        applyDateBounds();
        applyTimeBounds();
        toast.show(toast.successText, 'success');
      } catch (error) {
        console.error('[aroma] booking failed:', error);
        const message = error?.name === 'AbortError'
          ? 'Сервер не отвечает. Попробуйте ещё раз или позвоните нам.'
          : 'Не удалось отправить заявку. Попробуйте ещё раз или позвоните нам.';
        toast.show(message, 'error');
      } finally {
        setLoading(false);
      }
    });
  };

  /* ------------------------------------------------------------------------
     Запуск
     ------------------------------------------------------------------------ */
  const safe = (fn) => {
    try {
      fn();
    } catch (error) {
      console.error(`[aroma] ${fn.name} failed:`, error);
    }
  };

  const init = () => {
    [
      initImages,
      initHeader,
      initNav,
      initScrollSpy,
      initOpenStatus,
      initMenuTabs,
      initReveal,
      initBookingForm,
    ].forEach(safe);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();