// صفحة أوّل تشغيل: البرنامج بيجرّب العنوان (/health) قبل ما يحفظه
const form = document.getElementById('form');
const input = document.getElementById('url');
const error = document.getElementById('error');
const button = document.getElementById('save');

window.naeemanSetup.current().then((url) => { if (url) input.value = url; });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.style.display = 'none';
  button.disabled = true;
  button.textContent = 'بنجرّب العنوان…';
  const result = await window.naeemanSetup.save(input.value);
  if (!result.ok) {
    error.textContent = result.message;
    error.style.display = 'block';
    button.disabled = false;
    button.textContent = 'اتصل';
  }
});
