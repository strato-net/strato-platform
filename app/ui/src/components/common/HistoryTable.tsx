import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { Loader2 } from 'lucide-react';

export const LoadingRow = ({ colSpan }: { colSpan: number }) => (
  <TableRow>
    <TableCell colSpan={colSpan} className="text-center py-8">
      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
    </TableCell>
  </TableRow>
);

export const EmptyRow = ({ colSpan, message }: { colSpan: number; message: string }) => (
  <TableRow>
    <TableCell colSpan={colSpan} className="text-center py-8">
      <p className="text-muted-foreground">{message}</p>
    </TableCell>
  </TableRow>
);

export const PaginationInfo = ({ currentPage, itemsPerPage, totalCount, pageLength, noun }: {
  currentPage: number;
  itemsPerPage: number;
  totalCount: number;
  pageLength: number;
  /** Singular name of a row, e.g. "trade". */
  noun: string;
}) => {
  const start = (currentPage - 1) * itemsPerPage + 1;
  const end = Math.min(currentPage * itemsPerPage, totalCount);

  return (
    <div className="text-sm text-muted-foreground">
      {start === 1 && end === totalCount ? (
        `Showing ${pageLength} ${noun}${pageLength !== 1 ? 's' : ''}`
      ) : (
        `Showing ${start} to ${end} of ${totalCount} ${noun}s`
      )}
    </div>
  );
};

export const PaginationControls = ({
  currentPage,
  totalPages,
  loading,
  onPageChange
}: {
  currentPage: number;
  totalPages: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}) => {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1 || loading}
      >
        Previous
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {currentPage} of {totalPages}
        {loading && <span className="ml-2 text-blue-500">Loading...</span>}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage === totalPages || loading}
      >
        Next
      </Button>
    </div>
  );
};
