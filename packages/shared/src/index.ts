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

type ContractOptions<TCode extends string> = {
  code: TCode;
  message: string;
  traceId: string;
};

export const ok = <T>(data: T, message = ''): ApiSuccessResponse<T> => {
  return { success: true, data, message };
};

export const fail = (message: string): ApiErrorResponse => {
  return { success: false, data: null, message };
};

export function contractOk<T, TCode extends string>(
  data: T,
  options: ContractOptions<TCode>,
): ApiContractSuccess<T, TCode> {
  return {
    success: true,
    data,
    code: options.code,
    message: options.message,
    trace_id: options.traceId,
  };
}

export function contractFail<TCode extends string>(
  options: ContractOptions<TCode>,
): ApiContractError<TCode> {
  return {
    success: false,
    data: null,
    code: options.code,
    message: options.message,
    trace_id: options.traceId,
  };
}

export function buildPaginationMetadata(input: {
  page: number;
  pageSize: number;
  total: number;
}): PaginationMetadata {
  const totalPages =
    input.total === 0 ? 0 : Math.ceil(input.total / input.pageSize);
  return {
    page: input.page,
    page_size: input.pageSize,
    total: input.total,
    total_pages: totalPages,
    has_previous: input.page > 1,
    has_next: input.page < totalPages,
  };
}

export const formatYuan = (cents: number): string => {
  return (cents / 100).toFixed(2);
};
