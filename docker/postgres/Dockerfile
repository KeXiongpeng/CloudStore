FROM postgres:16-alpine

# Docker Hub 上的 pgvector 整包镜像下载不稳定时，
# 可基于本地已有 postgres:16-alpine 安装扩展。
# 注意：当前 Alpine 3.24 默认 pgvector 针对 PostgreSQL 18 编译；
# 这里固定使用 v3.20/community 中依赖 postgresql16 的 0.6.2 版本。
RUN apk add --no-cache \
    --repository=https://dl-cdn.alpinelinux.org/alpine/v3.20/community \
    postgresql-pgvector=0.6.2-r0

# Alpine 包使用发行版布局：/usr/lib/postgresql16 和 /usr/share/postgresql16。
# 官方 postgres:16-alpine 编译时使用 /usr/local 布局，
# 因此必须把 vector.so 和 control/sql 文件复制到服务器实际查找的目录。
RUN mkdir -p /usr/local/lib/postgresql /usr/local/share/postgresql/extension && \
    cp -a /usr/lib/postgresql16/vector.so /usr/local/lib/postgresql/ && \
    cp -a /usr/share/postgresql16/extension/* /usr/local/share/postgresql/extension/
