import { connect } from 'react-redux';
import { RootReducerState } from '../../../domain/common';
import TransactionsView, { TransactionsProps } from '../../../presentation/wallet/transactions';
import { walletTransactions } from '../selectors/transaction.selector';

const mapStateToProps = (state: RootReducerState): TransactionsProps => ({
  assets: state.assets,
  network: state.app.network,
  transactions: walletTransactions(state),
});

const Transactions = connect(mapStateToProps)(TransactionsView);

export default Transactions;