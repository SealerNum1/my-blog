```dockerfile
FROM python:3.11-alpine
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5000
RUN adduser -D appuser
USER appuser
CMD ["python","app.py"]
```

```yaml
version: "3.8"
services:
  web:
  	image: nginx:alpine
  	ports:
  	  - "80:80"
  	volumes:  
  	  - ./html:/usr/share/nginx/html
  	depends_on:
  	  - db
    networks:
      - app-net
  db:
  	image: mysql:8.0
	enviroment:
		MYSQL_ROOT_PASSWORD: "123456"
	volumes:
	  - db-data:/var/lib/mysql
	networks:
	  - app-net
volumes:
	db-data:
networks:
	app-net:
		driver: bridge
```

