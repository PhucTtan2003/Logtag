public record LtgeoReadingsEnvelope(
    List<LtgeoReadingDto> Data,
    string Status,
    DateTime TimestampUtc
);