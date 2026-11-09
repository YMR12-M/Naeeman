// صفحة أوّل تشغيل: سيرفر المحل (الكمبيوتر ده) أو اتصال بسيرفر موجود
const $ = (id) => document.getElementById(id);
const form = $('form');
const error = $('error');
const button = $('save');
let state = null;
let copyDir = '';

const mode = () => form.elements.mode.value || '';
const db = () => form.elements.db.value || 'external';

function show(message) {
  error.textContent = message;
  error.hidden = !message;
}

function render() {
  const current = mode();
  $('mode-hub-card').classList.toggle('on', current === 'hub');
  $('mode-remote-card').classList.toggle('on', current === 'remote');
  $('hub-new').hidden = !(current === 'hub' && !state.hubInitialized);
  $('hub-ready').hidden = !(current === 'hub' && state.hubInitialized);
  $('remote').hidden = current !== 'remote';
  $('db-external').hidden = db() !== 'external';
  button.hidden = !current;
  button.textContent = current === 'hub' ? (state.hubInitialized ? 'شغّل سيرفر المحل' : 'جهّز وشغّل') : 'اتصل';
}

async function init() {
  state = await window.naeemanSetup.state();
  $('url').value = state.serverUrl || '';
  $('api-port').value = state.apiPort;
  $('customer-port').value = state.customerPort;
  if (!state.mysqldAvailable) {
    $('db-bundled-label').classList.add('off');
    form.elements.db[0].disabled = true;
  }
  form.elements.db.value = state.mysqldAvailable ? 'bundled' : 'external';
  if (state.mode) form.elements.mode.value = state.mode;
  if (state.error) show(state.error);
  render();
}

form.addEventListener('change', render);

$('pick').addEventListener('click', async () => {
  const picked = await window.naeemanSetup.pickFolder();
  if (picked) { copyDir = picked; $('folder').textContent = picked; }
});

function hubInput() {
  const password = $('owner-password').value;
  if (password !== $('owner-password2').value) throw new Error('كلمتين السر مش زي بعض');
  return {
    hub: {
      apiPort: $('api-port').value,
      customerPort: $('customer-port').value,
      backupCopyDir: copyDir,
      mysql: db() === 'bundled'
        ? { mode: 'bundled' }
        : { mode: 'external', host: $('db-host').value, port: $('db-port').value, user: $('db-user').value, password: $('db-password').value },
    },
    owner: { shop: $('shop').value, name: $('owner-name').value, email: $('owner-email').value, password },
  };
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  show('');
  button.disabled = true;
  const idle = button.textContent;
  try {
    let result;
    if (mode() === 'remote') {
      button.textContent = 'بنجرّب العنوان…';
      result = await window.naeemanSetup.saveRemote($('url').value);
    } else if (mode() === 'hub') {
      button.textContent = state.hubInitialized ? 'بنشغّل السيرفر…' : 'بنجهّز القاعدة… (ممكن تاخد دقيقة)';
      result = await window.naeemanSetup.startHub(state.hubInitialized ? {} : hubInput());
    } else {
      return;
    }
    if (!result.ok) throw new Error(result.message);
  } catch (failure) {
    show(failure.message);
    button.disabled = false;
    button.textContent = idle;
  }
});

init();
