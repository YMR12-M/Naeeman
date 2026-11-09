# MySQL المتشحونة (ويندوز)

لو عايز برنامج الكمبيوتر يشتغل من غير ما المالك يسطّب MySQL، حطّ هنا نسخة
MySQL Community Server (ZIP لويندوز) مفكوكة بالشكل ده قبل `npm run dist`:

```
desktop/vendor/mysql/bin/mysqld.exe
desktop/vendor/mysql/lib/...
desktop/vendor/mysql/share/...
```

`electron-builder` بينسخها في `resources/mysql`، والبرنامج بيلاقيها لوحده
(`hub.js` ← `findMysqld`) ويجهّز مجلد البيانات في أوّل تشغيل بكلمة سر لـ root.
من غيرها خيار «MySQL متشحونة» بيتقفل في صفحة أوّل تشغيل، والمالك بيستعمل
MySQL متسطّبة على الجهاز.

الفولدر ده فاضي في الريبو (الملفات كبيرة) — `mysql/` في `.gitignore`.
