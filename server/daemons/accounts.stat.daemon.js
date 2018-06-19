// Accounts analytics for airdrops (public info)
const async			= require('async');
const mongoose      = require("mongoose");
const config      	= require('../../config');

const EOS     		= require('eosjs');
const eos     		= EOS(config.eosConfig);

mongoose.Promise = global.Promise;
const mongoMain  = mongoose.createConnection(config.MONGO_URI, config.MONGO_OPTIONS,
 (err) => {
    if (err){
      console.error(err);
      process.exit(1);
    }
    console.info('[Connected to Mongo EOS in accounts daemon] : 27017');
});

const STATS_ACCOUNT = require('../models/api.accounts.model')(mongoMain);
const SETTINGS 		= require('../models/api.stats.model')(mongoMain);

process.on('uncaughtException', (err) => {
	// rewrite to slack notify
    console.error('======= UncaughtException Accounts daemon server : ', err);
    process.exit(1);
});

function getAccountAggregation (){
	async.waterfall([
		(cb) => {
			SETTINGS.findOne({}, (err, result) => {
				if (err){
					return cb(err);
				}
				if (result){
					return cb(null, result);
				}
				let stat = new SETTINGS();
				stat.save( (err) => {
					if (err){
						return cb(err);
					}
					cb(null, stat);
				});
			});
		},
		(stat, cb) => {
			eos.getInfo({})
			   	.then(result => { 
			   		if (!result.head_block_num){
			   			return cb('Cant get info from blockchain getAccountAggregation!');
			   		}
			   		let elements = Array.from({length: result.head_block_num - stat.cursor_accounts}, (v, k) => stat.cursor_accounts++);
			   		cb(null, stat, result, elements);
			   	})
			   	.catch(err => {
			   		cb(err);
			   	});
		},
		(stat, result, elements, cb) => {
			async.eachLimit(elements, config.limitAsync, (elem, ret) => {
			   	eos.getBlock({ block_num_or_id: elem })
			   		.then(block => {
			   			if (block.transactions && block.transactions.length > 0){
			   				transactionsAggregate(block.transactions, stat, (accounts) => {
			   					stat.cursor_accounts = block.block_num;
			   					console.log(`======== SAVED - ${accounts} accoounts, block ${block.block_num}`);
			   					ret();
			   				});
			   			} else {
			   				stat.cursor_accounts = block.block_num;
			   				ret();
			   			}
			   		})
			   		.catch(err => {
			   			console.error('getStatAggregation getBlock elem error - ', err);
			   			ret();
			   		});
			   	}, (error) => {
			   		if (error){
			   			return cb(error)
			   		}
			   		stat.save((err) => {
			   				if (err){
			   					return cb(err);
			   				}
			   				cb(null, stat);
			   		});
			   	});
		}
	], (err, stat) => {
		if (err){
			console.error(err);
			process.exit(1);
		}
		console.log('===== end ', stat);
		process.exit(0);
	});
};


function transactionsAggregate (trx, stat, callback){
	let accounts = 0;
	async.each(trx, (elem, cbTx) => {
		if (!elem.trx || !elem.trx.transaction || !elem.trx.transaction.actions){
			console.error('elem.trx.transaction.actions - error', elem);
			return cbTx();
		}
	   	async.each(elem.trx.transaction.actions, (action, cbAction) => {
	   		STATS_ACCOUNT.find({ account_name: action.account }, (err, result) => {
	   			if (err){
	   				console.error(err);
	   				return cbAction();
	   			}
	   			if (result && result.length){
	   				return cbAction();
	   			}
	   			accounts++;
	   			let stat_acc = new STATS_ACCOUNT({
	   					account_name: action.account
	   			});
	   			stat_acc.save((err) => {
	   				if (err){
	   					console.error(err);
	   				}
	   				cbAction();
	   			})
	   		});
	   	}, (err) => {
	   		if (err){
	   			console.error(err);	
	   		}
	   		cbTx();
	   	});
	}, (error) => {
		if (error){
			console.error(error);
		}
		callback(accounts);
	});
}




// start main aggragate function
getAccountAggregation();







