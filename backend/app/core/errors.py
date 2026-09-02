from __future__ import annotations


class ApiError(Exception):
    status_code = 400

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class NotFound(ApiError):
    status_code = 404


class Conflict(ApiError):
    status_code = 409


class BadRequest(ApiError):
    status_code = 400
