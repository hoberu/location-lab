FROM python:3.11-slim
WORKDIR /app
COPY . /app
RUN python3 collector.py
EXPOSE 8080
ENV PORT=8080
CMD ["python3", "server.py", "--port", "8080"]
