public record LtgeoReadingDto(
    double Temperature,
    double? Humidity,
    double? Lux,
    double? Shock,
    decimal? Latitude,
    decimal? Longitude,
    DateTime DateUtc
);