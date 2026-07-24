declare module "@community-selection/shared" {
  export type ApiSuccessResponse<T> = {
    success: true;
    data: T;
    message: string;
  };

  export type ApiErrorResponse = {
    success: false;
    data: null;
    message: string;
  };

  export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

  export type CanonicalId = string;
  export type ExpectedVersion = number;
  export type IdempotencyKey = string;

  export type ApiContractMetadata<TCode extends string = string> = {
    code: TCode;
    message: string;
    trace_id: string;
  };

  export type ApiContractSuccess<
    T,
    TCode extends string = string,
  > = ApiContractMetadata<TCode> & {
    success: true;
    data: T;
  };

  export type ApiContractError<
    TCode extends string = string,
  > = ApiContractMetadata<TCode> & {
    success: false;
    data: null;
  };

  export type PaginationMetadata = {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
    has_previous: boolean;
    has_next: boolean;
  };

  export type PaginatedData<T> = {
    items: T[];
    pagination: PaginationMetadata;
  };

  export function ok<T>(data: T, message?: string): ApiSuccessResponse<T>;

  export function fail(message: string): ApiErrorResponse;

  export function contractOk<T, TCode extends string>(
    data: T,
    options: {
      code: TCode;
      message: string;
      traceId: string;
    },
  ): ApiContractSuccess<T, TCode>;

  export function contractFail<TCode extends string>(options: {
    code: TCode;
    message: string;
    traceId: string;
  }): ApiContractError<TCode>;

  export function buildPaginationMetadata(input: {
    page: number;
    pageSize: number;
    total: number;
  }): PaginationMetadata;

  export function formatYuan(cents: number): string;
}
