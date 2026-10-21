# שרת ג'נאייר: אינטגרציות + מסד נתונים משותף. בלי תלויות, ולכן בלי npm install.
# הגרסה מקובעת לשורת תיקוני אבטחה של Node 22; לקבע ל-digest (node:22.22-alpine@sha256:...) בפריסה לייצור, ולעדכן עם כל תיקון
FROM node:22.22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DB_MODE=file DATA_DIR=/data
COPY package.json ./
COPY src ./src
# הנתונים (db.json, קבצים וגיבויים יומיים) בכרך קבוע: docker run -v genair-data:/data ...
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1
CMD ["node", "src/server.js"]
