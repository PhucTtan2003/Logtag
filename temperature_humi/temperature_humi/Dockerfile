FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build

WORKDIR /src


COPY ["temperature_humi.csproj", "./"]

RUN dotnet restore "temperature_humi.csproj"

COPY . .

RUN dotnet publish "temperature_humi.csproj" \
    -c Release \
    -o /app/publish \
    --no-restore \
    /p:UseAppHost=false


FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime

WORKDIR /app

ENV ASPNETCORE_HTTP_PORTS=8080
ENV ASPNETCORE_ENVIRONMENT=Production

COPY --from=build /app/publish .

EXPOSE 8080

USER app

ENTRYPOINT ["dotnet", "temperature_humi.dll"]